// Unit tests for `src/reliability/storage.ts` (Phase 12 issue 001). Pure
// logic + hand-stubbed browser globals, no real I/O -- no wiring exists yet
// (issue 003) for integration tests to exercise, per the issue's "Test
// requirements" ("Unit tests only").
//
// Browser-global stubbing follows `src/context.test.ts`'s established
// pattern exactly: `Object.defineProperty(globalThis, ...)`, always torn
// down in `afterEach`.
//
// The IndexedDB adapter is exercised against a small in-file fake/stub of
// the `indexedDB` global (no external fake-indexeddb package -- zero vendor
// deps in core per CLAUDE.md).
import { afterEach, describe, expect, it, mock } from "bun:test";
import {
  createIndexedDbStorageAdapter,
  createLocalStorageAdapter,
  createMemoryStorageAdapter,
  detectBestStorage,
  type PersistedQueueEntry,
} from "./storage";
import type { CanonicalEvent } from "../schema";

function makeEntry(overrides: Partial<PersistedQueueEntry> = {}): PersistedQueueEntry {
  const event: CanonicalEvent = {
    name: "Test Event",
    properties: {},
    timestamp: Date.now(),
    anonymousId: "anon-1",
    sessionId: "session-1",
  };

  return {
    id: "entry-1",
    providerName: "test-provider",
    verb: "track",
    event,
    priority: 0,
    attempts: 0,
    enqueuedAt: Date.now(),
    nextAttemptAt: Date.now(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Browser-global stubbing helpers (mirrors src/context.test.ts).
// ---------------------------------------------------------------------------

function stubWindowAndNavigator(): void {
  Object.defineProperty(globalThis, "window", { value: {}, configurable: true, writable: true });
  Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true, writable: true });
}

function clearBrowserGlobals(): void {
  for (const key of ["window", "navigator", "indexedDB", "localStorage"] as const) {
    delete (globalThis as Record<string, unknown>)[key];
  }
}

afterEach(() => {
  clearBrowserGlobals();
});

// ---------------------------------------------------------------------------
// Fake localStorage test double.
// ---------------------------------------------------------------------------

interface FakeLocalStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function createFakeLocalStorage(): FakeLocalStorage {
  const data = new Map<string, string>();
  return {
    getItem(key) {
      return data.has(key) ? (data.get(key) as string) : null;
    },
    setItem(key, value) {
      data.set(key, value);
    },
    removeItem(key) {
      data.delete(key);
    },
  };
}

function stubLocalStorage(storage: unknown): void {
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true, writable: true });
}

// ---------------------------------------------------------------------------
// Fake IndexedDB test double -- minimal hand-rolled stub sufficient to
// exercise open/onupgradeneeded/transaction/getAll/put/clear. Every
// operation completes asynchronously via `queueMicrotask`, mirroring real
// IndexedDB's async-callback shape closely enough for this adapter's
// promisified wrapper to drive correctly.
// ---------------------------------------------------------------------------

interface FakeRequest<T> {
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
  result: T;
  error?: unknown;
}

function createFakeIndexedDb() {
  // dbName -> storeName -> id -> entry
  const databases = new Map<string, Map<string, Map<string, unknown>>>();

  function createTransaction(stores: Map<string, Map<string, unknown>>) {
    let pending = 0;
    let completed = false;
    const tx = {
      oncomplete: null as (() => void) | null,
      onerror: null as (() => void) | null,
      onabort: null as (() => void) | null,
      objectStore(name: string) {
        const data = stores.get(name);
        if (!data) {
          throw new Error(`fake indexedDB: no such object store "${name}"`);
        }

        function run<T>(compute: () => T): FakeRequest<T> {
          pending += 1;
          const req: FakeRequest<T> = { onsuccess: null, onerror: null, result: undefined as unknown as T };
          queueMicrotask(() => {
            req.result = compute();
            req.onsuccess?.();
            pending -= 1;
            if (pending === 0 && !completed) {
              completed = true;
              queueMicrotask(() => tx.oncomplete?.());
            }
          });
          return req;
        }

        return {
          getAll: () => run(() => Array.from(data.values())),
          put: (value: unknown) =>
            run(() => {
              const record = value as { id: string };
              data.set(record.id, value);
              return value;
            }),
          clear: () =>
            run(() => {
              data.clear();
              return undefined;
            }),
        };
      },
    };

    // Covers the (unused in this adapter, but real-IDB-accurate) case of a
    // transaction with no operations at all -- completes on its own.
    queueMicrotask(() => {
      if (pending === 0 && !completed) {
        completed = true;
        queueMicrotask(() => tx.oncomplete?.());
      }
    });

    return tx;
  }

  return {
    open(dbName: string, _version?: number) {
      const req: {
        onsuccess: (() => void) | null;
        onerror: (() => void) | null;
        onupgradeneeded: (() => void) | null;
        result: unknown;
      } = { onsuccess: null, onerror: null, onupgradeneeded: null, result: undefined };

      queueMicrotask(() => {
        let stores = databases.get(dbName);
        const isNew = !stores;
        if (!stores) {
          stores = new Map();
          databases.set(dbName, stores);
        }

        const db = {
          objectStoreNames: { contains: (name: string) => (stores as Map<string, unknown>).has(name) },
          createObjectStore(name: string) {
            const storeData = new Map<string, unknown>();
            (stores as Map<string, unknown>).set(name, storeData);
            return {};
          },
          transaction: (_storeNames: string | string[], _mode?: string) =>
            createTransaction(stores as Map<string, Map<string, unknown>>),
          close() {},
        };

        req.result = db;
        if (isNew) {
          req.onupgradeneeded?.();
        }
        req.onsuccess?.();
      });

      return req;
    },
  };
}

function stubIndexedDb(idb: unknown): void {
  Object.defineProperty(globalThis, "indexedDB", { value: idb, configurable: true, writable: true });
}

// ---------------------------------------------------------------------------
// createMemoryStorageAdapter
// ---------------------------------------------------------------------------

describe("createMemoryStorageAdapter", () => {
  it("has kind 'memory'", () => {
    expect(createMemoryStorageAdapter().kind).toBe("memory");
  });

  it("load() after save([a, b]) returns [a, b]", async () => {
    const adapter = createMemoryStorageAdapter();
    const a = makeEntry({ id: "a" });
    const b = makeEntry({ id: "b" });
    await adapter.save([a, b]);
    expect(await adapter.load()).toEqual([a, b]);
  });

  it("clear() empties it", async () => {
    const adapter = createMemoryStorageAdapter();
    await adapter.save([makeEntry({ id: "a" })]);
    await adapter.clear();
    expect(await adapter.load()).toEqual([]);
  });

  it("starts empty", async () => {
    expect(await createMemoryStorageAdapter().load()).toEqual([]);
  });

  it("multiple instances are fully independent (no shared module-level state)", async () => {
    const adapterA = createMemoryStorageAdapter();
    const adapterB = createMemoryStorageAdapter();
    await adapterA.save([makeEntry({ id: "only-in-a" })]);
    expect(await adapterB.load()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// createLocalStorageAdapter
// ---------------------------------------------------------------------------

describe("createLocalStorageAdapter", () => {
  const originalConsoleWarn = console.warn;

  afterEach(() => {
    console.warn = originalConsoleWarn;
  });

  it("has kind 'localstorage'", () => {
    stubLocalStorage(createFakeLocalStorage());
    expect(createLocalStorageAdapter("k").kind).toBe("localstorage");
  });

  it("round-trips entries through a stubbed localStorage", async () => {
    stubLocalStorage(createFakeLocalStorage());
    const adapter = createLocalStorageAdapter("queue-key");
    const a = makeEntry({ id: "a" });
    const b = makeEntry({ id: "b" });
    await adapter.save([a, b]);
    expect(await adapter.load()).toEqual([a, b]);
  });

  it("clear() empties it", async () => {
    stubLocalStorage(createFakeLocalStorage());
    const adapter = createLocalStorageAdapter("queue-key");
    await adapter.save([makeEntry()]);
    await adapter.clear();
    expect(await adapter.load()).toEqual([]);
  });

  it("load() returns [] for an absent key", async () => {
    stubLocalStorage(createFakeLocalStorage());
    const adapter = createLocalStorageAdapter("absent-key");
    expect(await adapter.load()).toEqual([]);
  });

  it("load() returns [] and warns once for a corrupt (non-JSON) stored value", async () => {
    const warn = mock(() => {});
    console.warn = warn as unknown as typeof console.warn;

    const storage = createFakeLocalStorage();
    storage.setItem("queue-key", "{not valid json");
    stubLocalStorage(storage);

    const adapter = createLocalStorageAdapter("queue-key");
    expect(await adapter.load()).toEqual([]);
    expect(await adapter.load()).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("save() swallows a thrown storage exception with a warning", async () => {
    const warn = mock(() => {});
    console.warn = warn as unknown as typeof console.warn;

    stubLocalStorage({
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {},
    });

    const adapter = createLocalStorageAdapter("queue-key");
    await expect(adapter.save([makeEntry()])).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("clear() swallows a thrown storage exception with a warning", async () => {
    const warn = mock(() => {});
    console.warn = warn as unknown as typeof console.warn;

    stubLocalStorage({
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {
        throw new Error("boom");
      },
    });

    const adapter = createLocalStorageAdapter("queue-key");
    await expect(adapter.clear()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// createIndexedDbStorageAdapter
// ---------------------------------------------------------------------------

describe("createIndexedDbStorageAdapter", () => {
  it("has kind 'indexeddb'", () => {
    stubIndexedDb(createFakeIndexedDb());
    expect(createIndexedDbStorageAdapter("db", "store").kind).toBe("indexeddb");
  });

  it("round-trips entries through a stubbed/fake IndexedDB", async () => {
    stubIndexedDb(createFakeIndexedDb());
    const adapter = createIndexedDbStorageAdapter("test-db", "test-store");
    const a = makeEntry({ id: "a" });
    const b = makeEntry({ id: "b" });
    await adapter.save([a, b]);
    const loaded = await adapter.load();
    expect(loaded.sort((x, y) => x.id.localeCompare(y.id))).toEqual([a, b]);
  });

  it("save() fully replaces prior contents (save([a]) after save([a, b])) leaves only [a]", async () => {
    stubIndexedDb(createFakeIndexedDb());
    const adapter = createIndexedDbStorageAdapter("test-db-2", "test-store");
    const a = makeEntry({ id: "a" });
    const b = makeEntry({ id: "b" });
    await adapter.save([a, b]);
    await adapter.save([a]);
    expect(await adapter.load()).toEqual([a]);
  });

  it("clear() empties the store", async () => {
    stubIndexedDb(createFakeIndexedDb());
    const adapter = createIndexedDbStorageAdapter("test-db-3", "test-store");
    await adapter.save([makeEntry()]);
    await adapter.clear();
    expect(await adapter.load()).toEqual([]);
  });

  it("persists across separate adapter instances against the same db/store name", async () => {
    const fakeIdb = createFakeIndexedDb();
    stubIndexedDb(fakeIdb);
    const adapterOne = createIndexedDbStorageAdapter("shared-db", "shared-store");
    const entry = makeEntry({ id: "persisted" });
    await adapterOne.save([entry]);

    const adapterTwo = createIndexedDbStorageAdapter("shared-db", "shared-store");
    expect(await adapterTwo.load()).toEqual([entry]);
  });
});

// ---------------------------------------------------------------------------
// detectBestStorage
// ---------------------------------------------------------------------------

describe("detectBestStorage", () => {
  it("outside a browser environment: returns memory, without touching indexedDB/localStorage", () => {
    let indexedDbTouched = false;
    let localStorageTouched = false;
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      get() {
        indexedDbTouched = true;
        return undefined;
      },
    });
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        localStorageTouched = true;
        return undefined;
      },
    });

    const adapter = detectBestStorage("app");
    expect(adapter.kind).toBe("memory");
    expect(indexedDbTouched).toBe(false);
    expect(localStorageTouched).toBe(false);
  });

  it("in a browser environment with indexedDB present: returns indexeddb", () => {
    stubWindowAndNavigator();
    stubIndexedDb(createFakeIndexedDb());
    stubLocalStorage(createFakeLocalStorage());

    const adapter = detectBestStorage("app");
    expect(adapter.kind).toBe("indexeddb");
  });

  it("with indexedDB absent but localStorage writable: returns localstorage", () => {
    stubWindowAndNavigator();
    stubLocalStorage(createFakeLocalStorage());

    const adapter = detectBestStorage("app");
    expect(adapter.kind).toBe("localstorage");
  });

  it("with both absent/throwing: returns memory, never throws", () => {
    stubWindowAndNavigator();
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      get() {
        throw new Error("indexedDB inaccessible");
      },
    });
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("localStorage inaccessible");
      },
    });

    let adapter: ReturnType<typeof detectBestStorage> | undefined;
    expect(() => {
      adapter = detectBestStorage("app");
    }).not.toThrow();
    expect(adapter?.kind).toBe("memory");
  });

  it("with localStorage present but writes throwing (e.g. quota/private mode): returns memory", () => {
    stubWindowAndNavigator();
    stubLocalStorage({
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {},
    });

    const adapter = detectBestStorage("app");
    expect(adapter.kind).toBe("memory");
  });

  it("derives the localStorage key from namePrefix (round-trips independently per prefix)", async () => {
    stubWindowAndNavigator();
    const storage = createFakeLocalStorage();
    stubLocalStorage(storage);

    const adapterA = detectBestStorage("app-a");
    const adapterB = detectBestStorage("app-b");
    const entry = makeEntry({ id: "a-entry" });
    await adapterA.save([entry]);
    expect(await adapterB.load()).toEqual([]);
    expect(await adapterA.load()).toEqual([entry]);
  });
});
