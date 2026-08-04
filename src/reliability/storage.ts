// Phase 12 issue 001: queue storage adapters + IndexedDB -> localStorage ->
// memory fallback detection. `src/reliability/` is this phase's own
// subdirectory (the Phase-12 analog of `src/plugins/`) since this phase
// ships multiple storage backends rather than a single flat file.
//
// This module is pure and standalone: no wiring into `createAnalytics()`,
// no dependency on issue 002's queue engine (which will depend on this
// issue's `QueueStorageAdapter` interface, not the reverse).
//
// Zero vendor deps (per CLAUDE.md's "zero vendor deps in core" rule) -- no
// `idb` or similar. Every IndexedDB operation below is promisified by hand.
//
// This package's root `tsconfig.json` deliberately has no `"dom"` in `lib`
// (see `src/context.ts`'s header comment for the full rationale), so
// `indexedDB`/`localStorage` aren't ambient types here. The handful of
// browser globals this module reads are typed with minimal ad-hoc shapes and
// accessed off `globalThis`, matching `src/context.ts`'s convention exactly
// -- this also happens to be the shape a test needs to stub via
// `Object.defineProperty(globalThis, ...)` without any DOM test-environment
// dependency.
import type { CanonicalEvent } from "../schema";
import { isBrowserEnvironment } from "../context";

// The JSON-serializable shape a queue entry is persisted as. `id` is a
// locally-unique string assigned by whoever enqueues the entry (issue 002's
// queue engine) -- this module never generates one itself, it only
// round-trips whatever it's given.
export interface PersistedQueueEntry {
  id: string;
  providerName: string;
  verb: "track" | "page" | "screen";
  event: CanonicalEvent;
  priority: number;
  attempts: number;
  enqueuedAt: number;
  nextAttemptAt: number;
}

// `save()` always receives and persists the *entire* current queue (whole-
// array overwrite, never an incremental diff) -- per BRIEF.md decision 4.
// Uniform across all three backends, even the IndexedDB one (which could
// technically support per-key put/delete) -- see this issue's "Design
// decisions" for why a richer, backend-specific interface isn't worth the
// leak into issue 002's adapter-agnostic queue engine.
export interface QueueStorageAdapter {
  readonly kind: "indexeddb" | "localstorage" | "memory";
  load(): Promise<PersistedQueueEntry[]>;
  save(entries: PersistedQueueEntry[]): Promise<void>;
  clear(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Minimal ad-hoc IndexedDB/localStorage shapes, read off `globalThis` (no
// ambient DOM lib types available in this package's tsconfig). Deliberately
// narrow -- only the surface this module actually calls.
// ---------------------------------------------------------------------------

interface MinimalStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface MinimalIDBRequest<T = unknown> {
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
  readonly result: T;
  readonly error?: unknown;
}

interface MinimalIDBOpenDbRequest extends MinimalIDBRequest<MinimalIDBDatabase> {
  onupgradeneeded: (() => void) | null;
}

interface MinimalIDBObjectStore {
  getAll(): MinimalIDBRequest<unknown[]>;
  put(value: unknown): MinimalIDBRequest<unknown>;
  clear(): MinimalIDBRequest<unknown>;
}

interface MinimalIDBTransaction {
  objectStore(name: string): MinimalIDBObjectStore;
  oncomplete: (() => void) | null;
  onerror: (() => void) | null;
  onabort: (() => void) | null;
}

interface MinimalIDBDatabase {
  readonly objectStoreNames: { contains(name: string): boolean };
  createObjectStore(name: string, options?: { keyPath?: string }): MinimalIDBObjectStore;
  transaction(storeNames: string | string[], mode?: "readonly" | "readwrite"): MinimalIDBTransaction;
  close(): void;
}

interface MinimalIDBFactory {
  open(name: string, version?: number): MinimalIDBOpenDbRequest;
}

interface StorageBrowserGlobal {
  indexedDB?: MinimalIDBFactory;
  localStorage?: MinimalStorage;
}

function storageGlobal(): StorageBrowserGlobal {
  return globalThis as unknown as StorageBrowserGlobal;
}

// ---------------------------------------------------------------------------
// Memory adapter -- plain closure-captured array, never throws. Also the
// adapter issue 002's unit tests use directly (no DOM/IndexedDB needed to
// test the pure queue engine).
// ---------------------------------------------------------------------------

export function createMemoryStorageAdapter(): QueueStorageAdapter {
  let entries: PersistedQueueEntry[] = [];

  return {
    kind: "memory",
    async load() {
      return entries.slice();
    },
    async save(newEntries) {
      entries = newEntries.slice();
    },
    async clear() {
      entries = [];
    },
  };
}

// ---------------------------------------------------------------------------
// localStorage adapter -- `load()` returns `[]` (never throws) for an absent
// key or corrupt (non-JSON) stored value; `save()`/`clear()` swallow a
// thrown storage exception (e.g. `QuotaExceededError`) with a `console.warn`
// -- a full localStorage must never crash `track()`/`page()`/`screen()`.
// ---------------------------------------------------------------------------

function getLocalStorage(): MinimalStorage | undefined {
  try {
    return storageGlobal().localStorage;
  } catch {
    return undefined;
  }
}

export function createLocalStorageAdapter(key: string): QueueStorageAdapter {
  // Warn at most once per adapter instance about corrupt stored data --
  // avoids spamming the console on every `load()` call for a queue that
  // never gets flushed clean.
  let warnedCorrupt = false;

  return {
    kind: "localstorage",
    async load() {
      try {
        const storage = getLocalStorage();
        const raw = storage?.getItem(key);
        if (raw == null) {
          return [];
        }

        try {
          const parsed: unknown = JSON.parse(raw);
          return Array.isArray(parsed) ? (parsed as PersistedQueueEntry[]) : [];
        } catch {
          if (!warnedCorrupt) {
            warnedCorrupt = true;
            console.warn(
              `typetrack: discarding corrupt (non-JSON) queue data at localStorage key "${key}"`,
            );
          }
          return [];
        }
      } catch {
        // Reading localStorage itself threw (e.g. disabled in some
        // private-browsing modes) -- treat identically to "nothing stored".
        return [];
      }
    },
    async save(entries) {
      try {
        const storage = getLocalStorage();
        storage?.setItem(key, JSON.stringify(entries));
      } catch (err) {
        console.warn(`typetrack: failed to persist queue to localStorage key "${key}"`, err);
      }
    },
    async clear() {
      try {
        const storage = getLocalStorage();
        storage?.removeItem(key);
      } catch (err) {
        console.warn(`typetrack: failed to clear localStorage key "${key}"`, err);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// IndexedDB adapter -- a single object store keyed by `PersistedQueueEntry.id`.
// Every operation (`open`, transaction, request) is promisified by hand; any
// `onerror`/exception rejects the returned Promise rather than throwing
// synchronously, so callers can `.catch()` uniformly (issue 002/003's job,
// not this issue's -- unlike the localStorage adapter above, this adapter
// does not itself swallow errors with a `console.warn`).
// ---------------------------------------------------------------------------

function getIndexedDb(): MinimalIDBFactory | undefined {
  try {
    return storageGlobal().indexedDB;
  } catch {
    return undefined;
  }
}

function promisifyRequest<T>(request: MinimalIDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function openDatabase(dbName: string, storeName: string): Promise<MinimalIDBDatabase> {
  const idb = getIndexedDb();
  if (!idb) {
    return Promise.reject(new Error("indexedDB is not available in this environment"));
  }

  return new Promise<MinimalIDBDatabase>((resolve, reject) => {
    let request: MinimalIDBOpenDbRequest;
    try {
      request = idb.open(dbName, 1);
    } catch (err) {
      reject(err);
      return;
    }

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(storeName)) {
        db.createObjectStore(storeName, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open IndexedDB database"));
  });
}

function transactionDone(tx: MinimalIDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(new Error("IndexedDB transaction aborted"));
  });
}

export function createIndexedDbStorageAdapter(dbName: string, storeName: string): QueueStorageAdapter {
  return {
    kind: "indexeddb",
    async load() {
      const db = await openDatabase(dbName, storeName);
      try {
        const tx = db.transaction(storeName, "readonly");
        const store = tx.objectStore(storeName);
        const result = await promisifyRequest(store.getAll());
        return Array.isArray(result) ? (result as PersistedQueueEntry[]) : [];
      } finally {
        db.close();
      }
    },
    async save(entries) {
      const db = await openDatabase(dbName, storeName);
      try {
        const tx = db.transaction(storeName, "readwrite");
        const store = tx.objectStore(storeName);
        // Whole-array overwrite (BRIEF.md decision 4) -- clear-then-put-all
        // is correct and simple, no per-entry diffing.
        store.clear();
        for (const entry of entries) {
          store.put(entry);
        }
        await transactionDone(tx);
      } finally {
        db.close();
      }
    },
    async clear() {
      const db = await openDatabase(dbName, storeName);
      try {
        const tx = db.transaction(storeName, "readwrite");
        tx.objectStore(storeName).clear();
        await transactionDone(tx);
      } finally {
        db.close();
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Fallback-chain probe: IndexedDB -> localStorage -> memory.
// ---------------------------------------------------------------------------

// Outside a browser environment, returns the memory adapter immediately (no
// probing). In a browser environment: a cheap synchronous presence check for
// `indexedDB` (not an actual open/write probe -- see this issue's "Design
// decisions"); else a synchronous localStorage write-then-remove probe; else
// the memory adapter. Every probe step is wrapped so a throw falls through
// to the next tier -- never propagates out of this function.
export function detectBestStorage(namePrefix: string): QueueStorageAdapter {
  if (!isBrowserEnvironment()) {
    return createMemoryStorageAdapter();
  }

  try {
    if (typeof storageGlobal().indexedDB !== "undefined") {
      return createIndexedDbStorageAdapter(`${namePrefix}-queue`, "queue");
    }
  } catch {
    // Fall through to the localStorage probe below.
  }

  try {
    const storage = storageGlobal().localStorage;
    if (storage) {
      const probeKey = `${namePrefix}-queue-probe`;
      storage.setItem(probeKey, "1");
      storage.removeItem(probeKey);
      return createLocalStorageAdapter(`${namePrefix}-queue`);
    }
  } catch {
    // Fall through to the memory adapter below.
  }

  return createMemoryStorageAdapter();
}
