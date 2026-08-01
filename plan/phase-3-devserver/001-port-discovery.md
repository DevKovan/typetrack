# 001 — Port discovery, health-check, and `.typetrack/port` file

## Context

The dev server (002) and CLI (005) both need a free TCP port to bind to,
starting at 4318 (OpenTelemetry's OTLP/HTTP convention — a memorable,
already-established default for a local telemetry-style tool), and other
local processes (a running app in dev mode, per 006) need to discover which
port was actually chosen once 4318 is taken.

There is no atomic "find a free port" primitive in Node/Bun — every
existing tool (e.g. npm's `get-port`) uses a probe-bind-then-release
pattern, which has an inherent small TOCTOU race between releasing the
probe socket and the real server binding it. This issue implements the
generic, reusable, race-*mitigated* (not race-*proof*) pieces in isolation,
so they're unit-testable without any HTTP route logic (002) existing yet:

- scanning for a free port starting at a given port, incrementing on
  conflict, up to a max attempt count
- polling an arbitrary URL until it responds (used by 002 to confirm its
  real bind is actually serving before considering a port "claimed")
- reading/writing `.typetrack/port`, creating `.typetrack/` if missing

002 is responsible for composing these with an actual `Bun.serve()` bind
and its own small retry-on-bind-failure loop (since the real race can only
be closed at the point of the real bind, not here).

## Acceptance criteria

- A function to scan for a free port: given a start port (default 4318), a
  max attempt count (default 20), and a hostname (default `127.0.0.1` —
  loopback only, this is a local dev tool, never bind `0.0.0.0`), probes
  candidate ports sequentially (probe-bind via a throwaway listener,
  release it immediately), returning the first free port found, or
  throwing a clear error after exhausting all attempts.
- A function to poll a URL until it returns HTTP 200 (or any 2xx) within a
  timeout (default e.g. 2s, configurable), for use as a post-bind health
  check; must not hang forever past the timeout, and must surface a clear
  timeout error distinguishable from a connection-refused error.
- A function to write the current port to `.typetrack/port` (plain text,
  just the port number), creating the `.typetrack/` directory if it
  doesn't exist.
- A function to read `.typetrack/port` back, returning `undefined` (not
  throwing) if the file/directory doesn't exist, and the parsed number if
  it does; must reject/ignore non-numeric file contents rather than
  returning `NaN` silently.
- A function to delete `.typetrack/port` (used on graceful shutdown by
  005), tolerant of the file already being absent.
- Root `.gitignore` gains a `.typetrack/` entry (alongside the existing
  `dist/` entry) — this is single-machine, ephemeral runtime data with no
  cross-machine or CI meaning.
- All of the above are exported from `src/devServer/` (module name left to
  the implementor) with no dependency on Bun.serve route handlers — this
  module must be importable and fully testable without 002 existing.

## Test requirements

**Unit**
- Free-port scan finds the given start port when it's free.
- Free-port scan skips a port that's occupied (test by holding it open
  with a real listener during the test) and returns the next free one.
- Free-port scan throws a clear error after exhausting max attempts when
  every candidate in range is occupied.
- Health-poll resolves once a test HTTP server starts responding 200 (can
  start the fake server on a short delay to prove it actually polls rather
  than checking once).
- Health-poll rejects/times out against a URL nothing is listening on,
  within roughly the configured timeout (assert it doesn't hang
  indefinitely and doesn't take dramatically longer than the timeout).
- Port-file write creates `.typetrack/` when absent and writes the correct
  number; read round-trips it back as a number.
- Port-file read returns `undefined` for a missing file and for a file
  containing non-numeric garbage.
- Port-file delete removes the file and does not throw when called twice
  (idempotent).

**Integration**
- In a real temp directory (not mocked fs), run the full sequence: scan
  for a free port starting from a port intentionally held busy by a real
  listener → get the next port → write it to `.typetrack/port` in that
  temp dir → read it back → delete it → confirm the file is gone on disk
  via a direct fs check (not just the read helper).
- Confirm `.typetrack/` is listed in the repo's root `.gitignore` (a
  simple file-content assertion is acceptable here) and that a file
  created under a real `.typetrack/` in the repo checkout is reported as
  ignored by git (e.g. via `git check-ignore`, shelled out, or an
  equivalent check against the parsed `.gitignore` — pick whichever the
  implementor's test setup supports).

## Out of scope

- Binding a real `Bun.serve()` instance or any HTTP route (002).
- Closing the probe-then-bind race entirely (accepted as a known,
  documented limitation; 002 must add its own retry loop around the real
  bind).
- Any behavior of the CLI (`typetrack dev` process lifecycle, SIGINT
  handling) — that's 005, which merely calls into these helpers.
- Detecting whether a previously-written port file's server is still
  alive (a "stale port file" check) — that's 005's concern, built on top
  of the health-poll helper here.
