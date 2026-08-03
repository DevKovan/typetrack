// Built-in `redactMiddleware` (Phase 8 issue 004): an opt-in middleware that
// strips PII/sensitive values out of a `CanonicalEvent` before it reaches any
// provider. It is a named export, never auto-registered by
// `createAnalytics()` -- an app must explicitly `.use(redactMiddleware({...}))`
// to enable it.
//
// Design note (replace, not delete): by default (and unless the caller
// supplies its own `replacement`), a configured field's *value* is replaced
// with the fixed string `"[REDACTED]"` -- the key itself is never removed
// from the object. This is deliberate: providers/downstream consumers that
// pattern-match on a field's *presence* (e.g. "does this event have a
// `plan` property at all") keep seeing the same event shape whether or not
// redaction ran, which avoids silently breaking schema/shape expectations
// elsewhere in the pipeline. Callers who genuinely want the key gone
// entirely should instead supply a `replacement` of `undefined` (which still
// leaves the key present with an `undefined` value in the object, not
// structurally removed) or filter the property out in their own middleware
// -- this middleware does not implement a "remove the key" mode.
import type { Middleware } from "../middleware";
import type { CanonicalEvent } from "../schema";

export interface RedactOptions {
  // Field paths to redact. A path with no `.` (e.g. `"email"`) redacts a
  // top-level key. A dotted path (e.g. `"user.ssn"`) descends into nested
  // plain objects -- this is supported, not just a top-level-only
  // implementation. A path segment that doesn't exist (at any depth) is a
  // silent no-op for that path; it never throws.
  fields: string[];
  // Either a fixed value used for every redacted field, or a function
  // called per field (`(fieldPath, value) => replacementValue`) so the
  // caller can vary the replacement based on the field or its original
  // value (e.g. preserve type, or hash instead of blanking). Defaults to
  // the fixed string `"[REDACTED]"`.
  replacement?: unknown | ((fieldPath: string, value: unknown) => unknown);
  // Which parts of the event to apply `fields` against. Defaults to
  // `["properties"]` only -- `context`/`metadata` are left untouched unless
  // explicitly opted into, since most PII lives in `properties` and
  // `context`/`metadata` are often infrastructure-owned (not
  // developer-authored) data.
  targets?: ("properties" | "context" | "metadata")[];
}

const DEFAULT_REPLACEMENT = "[REDACTED]";

function resolveReplacement(options: RedactOptions, fieldPath: string, value: unknown): unknown {
  if (typeof options.replacement === "function") {
    return (options.replacement as (fieldPath: string, value: unknown) => unknown)(fieldPath, value);
  }
  return options.replacement ?? DEFAULT_REPLACEMENT;
}

// Redacts a single (possibly dotted) `fieldPath` within `obj`, returning a
// new object with only the objects along the path shallow-cloned (siblings
// off the path keep their original references). Never mutates `obj`. If any
// segment of `fieldPath` doesn't exist, or an intermediate segment isn't a
// plain (non-array, non-null) object, this is a no-op -- returns `obj`
// unchanged (by reference), never throws.
function redactPath(
  obj: Record<string, unknown>,
  segments: string[],
  fieldPath: string,
  options: RedactOptions,
): Record<string, unknown> {
  const [key, ...rest] = segments;
  if (key === undefined || !(key in obj)) {
    return obj;
  }
  if (rest.length === 0) {
    return { ...obj, [key]: resolveReplacement(options, fieldPath, obj[key]) };
  }
  const nested = obj[key];
  if (typeof nested !== "object" || nested === null || Array.isArray(nested)) {
    return obj;
  }
  return { ...obj, [key]: redactPath(nested as Record<string, unknown>, rest, fieldPath, options) };
}

function redactObject(
  value: Record<string, unknown>,
  fields: string[],
  options: RedactOptions,
): Record<string, unknown> {
  let result = value;
  for (const field of fields) {
    result = redactPath(result, field.split("."), field, options);
  }
  return result;
}

// Builds the redaction middleware. Runs in `before()` only -- redaction has
// nothing to observe/react to after dispatch, so no `after()`/`onError()` is
// registered.
export function redactMiddleware(options: RedactOptions): Middleware {
  const targets = new Set(options.targets ?? ["properties"]);

  return {
    name: "redact",
    before(event: CanonicalEvent): CanonicalEvent {
      return {
        ...event,
        properties: targets.has("properties")
          ? redactObject(event.properties, options.fields, options)
          : event.properties,
        context:
          targets.has("context") && event.context !== undefined
            ? redactObject(event.context, options.fields, options)
            : event.context,
        metadata:
          targets.has("metadata") && event.metadata !== undefined
            ? redactObject(event.metadata, options.fields, options)
            : event.metadata,
      };
    },
  };
}
