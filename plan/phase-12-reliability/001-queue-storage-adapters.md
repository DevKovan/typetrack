# 001 — `src/reliability/storage.ts`: queue storage adapters + fallback detection

## Context

New `src/reliability/` directory — the Phase 12 analog of `src/plugins/`
(a subdirectory for a phase's own family of implementations, not a single
flat file, since this phase ships multiple storage backends). This issue
is pure and standalone: no wiring into `createAnalytics()`, no dependency
on issue 002's queue engine (which will depend on this issue's adapter
interface, not the reverse). Zero vendor deps (per CLAUDE.md's "zero
vendor deps in core" rule) — IndexedDB and localStorage are native browser
APIs, not vendor SDKs.

Read src/context.ts's `isBrowserEnvironment()` and its try/catch-never-
throw convention for touching `window`/`navigator` before starting — this
issue's adapters must follow the identical convention for `indexedDB`/
`localStorage`.

## Scope of this issue

`src/reliability/storage.ts` exports:

- `PersistedQueueEntry` — the JSON-serializable shape a queue entry is
  stored as: `{ id: string; providerName: string; verb: "track" | "page"
  | "screen"; event: CanonicalEvent; priority: number; attempts: number;
  enqueuedAt: number; nextAttemptAt: number }`. (`id` is a locally-unique
  string, e.g. via `crypto.randomUUID()` when available, falling back to a
  timestamp+counter scheme identical in spirit to how `anonymousId`/
  `sessionId` are generated elsewhere in `src/` — check `src/index.ts` for
  the existing ID-generation helper and reuse it rather than inventing a
  second one.)
- `QueueStorageAdapter` interface:
  ```ts
  interface QueueStorageAdapter {
    readonly kind: "indexeddb" | "localstorage" | "memory";
    load(): Promise<PersistedQueueEntry[]>;
    save(entries: PersistedQueueEntry[]): Promise<void>;
    clear(): Promise<void>;
  }
  ```
  Per BRIEF.md's decision 4, `save()` always receives and persists the
  **entire** current queue (whole-array overwrite), never an incremental
  diff.
- `createMemoryStorageAdapter(): QueueStorageAdapter` — `kind: "memory"`,
  backed by a plain closure-captured array. Never throws. This is also the
  adapter used directly by issue 002's unit tests (no DOM/IndexedDB
  needed to test the pure queue engine).
- `createLocalStorageAdapter(key: string): QueueStorageAdapter` — `kind:
  "localstorage"`, backed by `localStorage.getItem(key)`/`setItem(key,
  JSON.stringify(entries))`. `load()` returns `[]` (not a throw) if the
  key is absent, or if the stored value fails `JSON.parse` (corrupt data
  is discarded, matching BRIEF.md decision 9 — log via `console.warn`
  once when this happens). `save()`/`clear()` swallow a thrown
  `QuotaExceededError` (or any storage exception) with a `console.warn` —
  a full localStorage must never crash `track()`/`page()`/`screen()`.
- `createIndexedDbStorageAdapter(dbName: string, storeName: string):
  QueueStorageAdapter` — `kind: "indexeddb"`, a single object store
  keyed by `PersistedQueueEntry.id`. `load()` = open DB (create the
  store on `onupgradeneeded` if missing) → `getAll()` on the store.
  `save(entries)` = open a `readwrite` transaction, `clear()` the store,
  then `put()` every entry (whole-array overwrite per decision 4, so
  clear-then-put-all is correct and simple — no diffing). `clear()` =
  open a `readwrite` transaction and `clear()` the store. Every IndexedDB
  operation (`open`, transaction, request) is promisified by hand (no
  external library — e.g. `idb` — per CLAUDE.md's zero-vendor-deps rule);
  any `onerror`/exception rejects the returned Promise rather than
  throwing synchronously, so callers can `.catch()` uniformly.
- `detectBestStorage(namePrefix: string): QueueStorageAdapter` — the
  fallback-chain probe (BRIEF.md's ROADMAP-named "IndexedDB → localStorage
  → memory fallback chain"): outside a browser environment
  (`!isBrowserEnvironment()`), returns the memory adapter immediately (no
  probing). In a browser environment: attempts a cheap synchronous
  presence check for `indexedDB` (typeof check, not an actual open/write
  probe — a full open-and-write probe would require awaiting inside a
  function this issue keeps synchronous) and returns the IndexedDB
  adapter if present; else attempts a synchronous localStorage
  write-then-remove probe (mirroring the exact pattern
  `src/context.ts`/existing plugins already use to test localStorage
  availability under privacy-mode/quota restrictions) and returns the
  localStorage adapter if that succeeds; else returns the memory adapter.
  Every probe step is wrapped so a throw falls through to the next tier,
  never propagating out of `detectBestStorage()`. `namePrefix` is used to
  derive both the IndexedDB `dbName` and the localStorage key (e.g.
  `` `${namePrefix}-queue` ``), so multiple `Analytics` instances in the
  same page (rare, but not disallowed) don't collide on the same storage
  key by default — issue 003 decides the exact prefix value used at
  `createAnalytics()` call sites.

## Design decisions made in this issue

- **`detectBestStorage`'s IndexedDB check is a presence probe, not a
  write probe.** A real "can I actually write" check would require making
  the function async (opening a DB is inherently async) and is arguably
  overkill for a fallback chain whose job is graceful degradation, not
  perfect detection — if IndexedDB is present but write-restricted for
  some unusual reason, individual `save()` calls still fail gracefully
  (rejected Promise, caught by issue 003's wiring) rather than crashing;
  this issue does not additionally fall back to localStorage mid-session
  if IndexedDB turns out to be unusable after the fact.
- **Whole-array `save()`/`load()` (not per-entry CRUD in the public
  interface)**, even for the IndexedDB adapter, which could technically
  support per-key `put`/`delete` — chosen for interface uniformity across
  all three adapters and because BRIEF.md decision 4 already commits to
  whole-array persistence semantics at the queue-engine level; giving the
  IndexedDB adapter a different, richer interface than the other two
  would leak backend-specific capability into the engine, which issue
  002 is specifically designed to stay adapter-agnostic against.

## Acceptance criteria

- `src/reliability/storage.ts` exists, exports exactly the surface above.
- `createMemoryStorageAdapter()`: `load()` after `save([a, b])` returns
  `[a, b]`; `clear()` empties it; multiple adapter instances are fully
  independent (no shared module-level state).
- `createLocalStorageAdapter(key)`: round-trips entries through a stubbed
  `localStorage`; `load()` returns `[]` for an absent key and for a
  corrupt (non-JSON) stored value, warning once in the corrupt case;
  `save()`/`clear()` swallow a thrown storage exception with a warning
  rather than propagating.
- `createIndexedDbStorageAdapter(dbName, storeName)`: round-trips entries
  through a stubbed/fake IndexedDB (see Test requirements); `save()`
  fully replaces prior contents (a `save([a])` after a `save([a, b])`
  leaves only `[a]` on the next `load()`).
- `detectBestStorage()` outside a browser environment: returns a `kind:
  "memory"` adapter, without touching `indexedDB`/`localStorage` at all.
- `detectBestStorage()` in a stubbed browser environment with `indexedDB`
  present: returns a `kind: "indexeddb"` adapter.
- `detectBestStorage()` with `indexedDB` absent but `localStorage`
  writable: returns a `kind: "localstorage"` adapter.
- `detectBestStorage()` with both absent/throwing: returns a `kind:
  "memory"` adapter, never throws.

## Test requirements

Unit tests only (`src/reliability/storage.test.ts`) — no wiring exists
yet for integration tests to exercise.

- Every adapter's round-trip (`save` → `load`, `clear` → `load` empty)
  and error-swallowing behavior described above.
- For the IndexedDB adapter: Bun's test environment has no native
  IndexedDB — use a minimal hand-rolled fake/stub of the `indexedDB`
  global sufficient to exercise `open`/`onupgradeneeded`/transaction/
  `getAll`/`put`/`clear` (do not pull in an external fake-indexeddb
  package — zero vendor deps in core per CLAUDE.md; a small in-file test
  double is expected and sufficient here, mirroring how other phases'
  tests stub `localStorage`/`navigator` by hand rather than importing a
  polyfill).
- `detectBestStorage`'s four branches (non-browser; IndexedDB present;
  IndexedDB absent + localStorage writable; both absent), via the same
  global-stubbing technique `src/context.test.ts` established.

## Out of scope

- The queue engine (priority ordering, backoff, `maxQueueSize` eviction,
  dead-lettering) — issue 002.
- Any `createAnalytics()` wiring — issue 003.
- Cross-tab coordination — explicitly out of scope for the whole phase,
  see BRIEF.md.
