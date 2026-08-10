import { z } from "zod";
import { formatSuccessLine, formatValidationDiff } from "./format";
import { renderInspectorPage } from "./inspectorPage";
import { deletePortFile, writePortFile } from "./portFile";
import { findFreePort, waitForHealthy } from "./ports";
import { buildEventJsonSchemas } from "./schemaExport";
import { createSseUnderlyingSource } from "./sse";

export interface DevServerOptions {
  startPort?: number;
  hostname?: string;
  bufferSize?: number;
}

// One recorded `POST /events` call. `issues` is only present when
// `valid` is `false` and mirrors `EventValidationError.issues`'s shape
// (`src/schema.ts`) so dev-server consumers see the same issue shape the
// core SDK itself throws.
export interface DevServerEvent {
  event: string;
  payload: unknown;
  timestamp: number;
  valid: boolean;
  issues?: z.ZodIssue[];
}

export type DevServerListener = (event: DevServerEvent) => void;

export interface DevServerHandle {
  port: number;
  url: string;
  setSchemas(schemas: Record<string, z.ZodType> | undefined): void;
  getEvents(): DevServerEvent[];
  subscribe(listener: DevServerListener): () => void;
  stop(): Promise<void>;
  // Testing-only accessor for the number of currently-registered `subscribe()`
  // listeners (including active SSE clients) -- lets tests assert a
  // subscription was actually released on disconnect/unsubscribe.
  getSubscriberCount(): number;
}

const MAX_BIND_ATTEMPTS = 3;

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function startDevServer(options: DevServerOptions = {}): Promise<DevServerHandle> {
  const { startPort = 4318, hostname = "127.0.0.1", bufferSize = 500 } = options;

  // `undefined` = "no schemas loaded yet" -- every event is unvalidated
  // passthrough (`valid: true`), matching the core SDK's own schema-less
  // behavior. 004 drives this via `setSchemas()` after loading a real
  // config file; this issue only provides the seam.
  let schemas: Record<string, z.ZodType> | undefined;
  const buffer: DevServerEvent[] = [];
  const listeners = new Set<DevServerListener>();

  function setSchemas(next: Record<string, z.ZodType> | undefined): void {
    schemas = next;
  }

  function getEvents(): DevServerEvent[] {
    return [...buffer];
  }

  function subscribe(listener: DevServerListener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function getSubscriberCount(): number {
    return listeners.size;
  }

  // Validates against the currently-loaded schema (if any), appends to the
  // ring buffer (evicting the oldest entry once full), broadcasts to 003's
  // future SSE subscribers, and logs a diff (failure) or one line (success).
  function recordEvent(event: string, payload: unknown): DevServerEvent {
    const schema = schemas?.[event];
    let valid = true;
    let issues: z.ZodIssue[] | undefined;

    if (schema) {
      const result = schema.safeParse(payload);
      valid = result.success;
      if (!result.success) issues = result.error.issues;
    }

    const record: DevServerEvent = { event, payload, timestamp: Date.now(), valid };
    if (issues) record.issues = issues;

    buffer.push(record);
    if (buffer.length > bufferSize) buffer.shift();

    for (const listener of listeners) listener(record);

    console.log(valid ? formatSuccessLine(event) : formatValidationDiff(event, issues ?? []));

    return record;
  }

  async function handlePostEvents(request: Request): Promise<Response> {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: "Malformed JSON body" }, 400);
    }

    if (
      typeof body !== "object" ||
      body === null ||
      typeof (body as Record<string, unknown>).event !== "string"
    ) {
      return jsonResponse({ error: "Body must be a JSON object with a string `event` field" }, 400);
    }

    const { event, payload } = body as { event: string; payload?: unknown };
    const record = recordEvent(event, payload);

    return jsonResponse({ accepted: true, valid: record.valid }, 200);
  }

  function handleGetEvents(): Response {
    return jsonResponse(getEvents(), 200);
  }

  function handleGetSchema(): Response {
    return jsonResponse(buildEventJsonSchemas(schemas), 200);
  }

  function handleGetHealth(): Response {
    return jsonResponse({ ok: true }, 200);
  }

  // Live SSE feed of events recorded from this point forward (no replay of
  // buffered history -- see 003's "Out of scope"). `server.timeout(request, 0)`
  // disables Bun's default idle-connection timeout for this one request,
  // since an SSE connection is expected to sit open (and otherwise idle
  // between events) indefinitely.
  function handleGetEventsStream(request: Request, server: ReturnType<typeof Bun.serve>): Response {
    server.timeout(request, 0);
    const stream = new ReadableStream<Uint8Array>(createSseUnderlyingSource(subscribe));
    return new Response(stream, {
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      },
    });
  }

  // The real bind may itself hit the probe-then-release race noted in
  // `findFreePort`'s comment (something else claims the candidate port
  // between the probe and this real bind) -- retry a small number of times,
  // re-scanning for a fresh candidate (starting past the one that just
  // failed) on each attempt.
  let server: ReturnType<typeof Bun.serve> | undefined;
  let lastError: unknown;
  let candidateStart = startPort;

  for (let attempt = 0; attempt < MAX_BIND_ATTEMPTS; attempt++) {
    const candidatePort = await findFreePort({ startPort: candidateStart, hostname });
    try {
      server = Bun.serve({
        port: candidatePort,
        hostname,
        routes: {
          "/": {
            GET: () =>
              new Response(renderInspectorPage(), {
                status: 200,
                headers: { "content-type": "text/html; charset=utf-8" },
              }),
          },
          "/events": {
            POST: handlePostEvents,
            GET: handleGetEvents,
          },
          "/events/stream": {
            GET: handleGetEventsStream,
          },
          "/schema": {
            GET: handleGetSchema,
          },
          "/health": {
            GET: handleGetHealth,
          },
        },
        fetch() {
          return jsonResponse({ error: "Not found" }, 404);
        },
      });
      break;
    } catch (error) {
      lastError = error;
      server = undefined;
      candidateStart = candidatePort + 1;
    }
  }

  if (!server) {
    throw lastError instanceof Error
      ? lastError
      : new Error(`Failed to bind dev server after ${MAX_BIND_ATTEMPTS} attempts`);
  }

  const boundServer = server;
  const port = boundServer.port;
  if (port === undefined) {
    // Only possible for a unix-socket bind, which this function never
    // requests -- narrows `Server["port"]`'s `number | undefined` type.
    throw new Error("Dev server bound without a TCP port");
  }
  const url = `http://${hostname}:${port}`;

  await waitForHealthy(`${url}/health`);
  await writePortFile(port);

  return {
    port,
    url,
    setSchemas,
    getEvents,
    subscribe,
    getSubscriberCount,
    async stop() {
      boundServer.stop(true);
      await deletePortFile();
    },
  };
}
