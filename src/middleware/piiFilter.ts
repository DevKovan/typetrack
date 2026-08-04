// Built-in `piiFilterMiddleware` (Phase 11 issue 007): an opt-in middleware
// that recursively redacts values whose *key name* matches a PII-shaped
// pattern, at any depth within a `CanonicalEvent`'s targets. A named export,
// never auto-registered by `createAnalytics()` -- an app must explicitly
// `.use(piiFilterMiddleware({...}))` (or `.use(piiFilterMiddleware())` for
// the defaults) to enable it.
//
// Complementary to, not a replacement for, `redactMiddleware`
// (`./redact.ts`, Phase 8): that middleware redacts exact (possibly dotted)
// field *paths* the app enumerates in advance, and does not descend into
// arrays. This middleware instead walks every plain object and array,
// recursively, and redacts any key whose *name* matches a pattern --
// catching PII in shapes the app didn't know to enumerate up front (e.g. an
// array of objects like `attendees: [{ email }, { email }]`). Both may be
// registered together via `.use()`; neither supersedes the other.
//
// Key-name pattern matching only -- this middleware never inspects a
// value's *content* (e.g. a raw email-shaped string under an unexpectedly
// named key like `notes` is out of scope; see the issue's "Out of scope").
import type { Middleware } from "../middleware";
import type { CanonicalEvent } from "../schema";

export interface PiiFilterOptions {
  // Additional key-name patterns beyond the built-in defaults (see
  // `DEFAULT_PATTERNS` below). A plain `string` pattern matches
  // case-insensitively as a *substring* of the key name (e.g. `"email"`
  // matches a key named `"userEmail"` or `"EMAIL_ADDRESS"`). A `RegExp` is
  // tested against the key name as-is -- case sensitivity is entirely the
  // caller's responsibility via the regex's own flags (no implicit `i`).
  patterns?: (string | RegExp)[];
  // When `true` (the default), `patterns` above are merged with the
  // built-in default list. When `false`, the built-in list is replaced
  // entirely -- only `patterns` is used to match key names.
  extendDefaults?: boolean;
  // Either a fixed value used for every redacted field, or a function
  // called per field (`(fieldPath, value) => replacementValue`), mirroring
  // `redactMiddleware`'s option of the same name/shape/default for
  // consistency. `fieldPath` here is the dotted path this middleware
  // computed during its own recursive walk (e.g. `"lineItems.0.email"` for
  // an array element), not a caller-supplied path. Defaults to the fixed
  // string `"[REDACTED]"`.
  replacement?: unknown | ((fieldPath: string, value: unknown) => unknown);
  // Which parts of the event to walk. Defaults to `["properties"]` only --
  // `context`/`metadata` are left untouched unless explicitly opted into,
  // mirroring `redactMiddleware`'s default/semantics.
  targets?: ("properties" | "context" | "metadata")[];
}

// A documented, non-exhaustive starting point for common PII key-name
// shapes -- NOT a compliance guarantee. Apps with specific regulatory
// obligations (GDPR/CCPA/HIPAA/etc.) should supply their own `patterns`
// (via `extendDefaults: false` for a from-scratch list, or the default
// `extendDefaults: true` to layer additional patterns on top of these).
const DEFAULT_PATTERNS: string[] = [
  "email",
  "phone",
  "phoneNumber",
  "ssn",
  "socialSecurityNumber",
  "password",
  "passwd",
  "creditCard",
  "cardNumber",
  "cvv",
  "address",
  "street",
  "zipcode",
  "postalCode",
  "dob",
  "dateOfBirth",
  "birthdate",
];

const DEFAULT_REPLACEMENT = "[REDACTED]";

function resolveReplacement(options: PiiFilterOptions, fieldPath: string, value: unknown): unknown {
  if (typeof options.replacement === "function") {
    return (options.replacement as (fieldPath: string, value: unknown) => unknown)(fieldPath, value);
  }
  return options.replacement ?? DEFAULT_REPLACEMENT;
}

function resolvePatterns(options: PiiFilterOptions): (string | RegExp)[] {
  const extra = options.patterns ?? [];
  const extendDefaults = options.extendDefaults ?? true;
  return extendDefaults ? [...DEFAULT_PATTERNS, ...extra] : extra;
}

function keyMatchesPattern(key: string, pattern: string | RegExp): boolean {
  if (typeof pattern === "string") {
    return key.toLowerCase().includes(pattern.toLowerCase());
  }
  return pattern.test(key);
}

function keyMatchesAnyPattern(key: string, patterns: (string | RegExp)[]): boolean {
  return patterns.some((pattern) => keyMatchesPattern(key, pattern));
}

// True for a plain (non-array, non-null) object -- the only shape this
// middleware recurses into for object-typed values.
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Recursively walks `value` (a plain object), redacting any key whose name
// matches `patterns` and recursing into nested plain objects/arrays for
// keys that don't match. Never mutates `value` -- returns a new object with
// only the objects/arrays along a redacted path shallow-cloned; siblings
// off any redacted path keep their original references. Assumes JSON-safe
// (non-cyclic) input -- no cycle detection is attempted, matching this
// middleware's documented scope.
function redactObject(
  value: Record<string, unknown>,
  patterns: (string | RegExp)[],
  options: PiiFilterOptions,
  pathPrefix: string,
): Record<string, unknown> {
  let changed = false;
  const result: Record<string, unknown> = { ...value };

  for (const key of Object.keys(value)) {
    const fieldPath = pathPrefix ? `${pathPrefix}.${key}` : key;
    const original = value[key];

    if (keyMatchesAnyPattern(key, patterns)) {
      result[key] = resolveReplacement(options, fieldPath, original);
      changed = true;
      continue;
    }

    if (Array.isArray(original)) {
      const redactedArray = redactArray(original, patterns, options, fieldPath);
      if (redactedArray !== original) {
        result[key] = redactedArray;
        changed = true;
      }
      continue;
    }

    if (isPlainObject(original)) {
      const redactedNested = redactObject(original, patterns, options, fieldPath);
      if (redactedNested !== original) {
        result[key] = redactedNested;
        changed = true;
      }
    }
  }

  return changed ? result : value;
}

// Recursively walks `value` (an array), recursing into elements that are
// plain objects (their own keys checked against `patterns`, with the
// element's numeric index appended to the dotted path) or nested arrays.
// Elements that are not plain objects/arrays (primitives, `null`) are left
// untouched. Never mutates `value` -- only shallow-clones the array itself
// when at least one element changed.
function redactArray(
  value: unknown[],
  patterns: (string | RegExp)[],
  options: PiiFilterOptions,
  pathPrefix: string,
): unknown[] {
  let changed = false;
  const result = value.map((element, index) => {
    const fieldPath = `${pathPrefix}.${index}`;
    if (Array.isArray(element)) {
      const redacted = redactArray(element, patterns, options, fieldPath);
      if (redacted !== element) changed = true;
      return redacted;
    }
    if (isPlainObject(element)) {
      const redacted = redactObject(element, patterns, options, fieldPath);
      if (redacted !== element) changed = true;
      return redacted;
    }
    return element;
  });

  return changed ? result : value;
}

// Builds the PII pattern-redaction middleware. Runs in `before()` only --
// matches `redactMiddleware`'s precedent (nothing to observe/react to after
// dispatch), so no `after()`/`onError()` is registered.
export function piiFilterMiddleware(options: PiiFilterOptions = {}): Middleware {
  const targets = new Set(options.targets ?? ["properties"]);
  const patterns = resolvePatterns(options);

  return {
    name: "piiFilter",
    before(event: CanonicalEvent): CanonicalEvent {
      return {
        ...event,
        properties: targets.has("properties")
          ? redactObject(event.properties, patterns, options, "")
          : event.properties,
        context:
          targets.has("context") && event.context !== undefined
            ? redactObject(event.context, patterns, options, "")
            : event.context,
        metadata:
          targets.has("metadata") && event.metadata !== undefined
            ? redactObject(event.metadata, patterns, options, "")
            : event.metadata,
      };
    },
  };
}
