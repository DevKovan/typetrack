// Unit tests for `src/reliability/queue.ts` (Phase 12 issue 002). Pure
// logic against issue 001's `createMemoryStorageAdapter()` -- no real
// IndexedDB/localStorage, no wiring exists yet (issue 003) for integration
// tests to exercise, per the issue's "Test requirements" ("Unit tests
// only").
import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { computeBackoffDelay, createQueueEngine, type QueueEngine } from "./queue";
import { createMemoryStorageAdapter, type PersistedQueueEntry, type QueueStorageAdapter } from "./storage";
import type { CanonicalEvent } from "../schema";

function makeEvent(name = "Test Event"): CanonicalEvent {
  return {
    name,
    properties: {},
    timestamp: Date.now(),
    anonymousId: "anon-1",
    sessionId: "session-1",
  };
}

type EnqueueInput = Omit<PersistedQueueEntry, "id" | "attempts" | "enqueuedAt" | "nextAttemptAt">;

function makeEnqueueInput(overrides: Partial<EnqueueInput> = {}): EnqueueInput {
  return {
    providerName: "test-provider",
    verb: "track",
    event: makeEvent(),
    priority: 0,
    ...overrides,
  };
}

const originalConsoleWarn = console.warn;

afterEach(() => {
  console.warn = originalConsoleWarn;
});

// ---------------------------------------------------------------------------
// computeBackoffDelay
// ---------------------------------------------------------------------------

describe("computeBackoffDelay", () => {
  it("defaults: baseMs 1000, factor 2, maxMs 30000", () => {
    expect(computeBackoffDelay(0, undefined)).toBe(1000);
    expect(computeBackoffDelay(1, undefined)).toBe(2000);
    expect(computeBackoffDelay(2, undefined)).toBe(4000);
  });

  it("grows exponentially and clamps at maxMs for large attempts", () => {
    expect(computeBackoffDelay(10, undefined)).toBe(30000);
    expect(computeBackoffDelay(100, undefined)).toBe(30000);
  });

  it("respects custom options", () => {
    expect(computeBackoffDelay(0, { baseMs: 500, factor: 3, maxMs: 5000 })).toBe(500);
    expect(computeBackoffDelay(1, { baseMs: 500, factor: 3, maxMs: 5000 })).toBe(1500);
    expect(computeBackoffDelay(2, { baseMs: 500, factor: 3, maxMs: 5000 })).toBe(4500);
    // 500 * 3^3 = 13500, clamped to 5000
    expect(computeBackoffDelay(3, { baseMs: 500, factor: 3, maxMs: 5000 })).toBe(5000);
  });

  it("fills in individual missing fields with defaults", () => {
    expect(computeBackoffDelay(1, { baseMs: 500 })).toBe(1000);
    expect(computeBackoffDelay(1, { factor: 4 })).toBe(4000);
    expect(computeBackoffDelay(20, { maxMs: 1000 })).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// createQueueEngine -- enqueue
// ---------------------------------------------------------------------------

describe("createQueueEngine: enqueue", () => {
  it("assigns a unique id per call, attempts: 0, and nextAttemptAt equal to enqueue time", async () => {
    const storage = createMemoryStorageAdapter();
    const engine = createQueueEngine({ storage });
    await engine.hydrate();

    const now = Date.now();
    await engine.enqueue(makeEnqueueInput());
    await engine.enqueue(makeEnqueueInput());

    const after = Date.now();
    const ready = engine.peekReady(after);
    expect(ready).toHaveLength(2);
    expect(ready[0]?.id).not.toBe(ready[1]?.id);
    for (const entry of ready) {
      expect(entry.attempts).toBe(0);
      expect(entry.nextAttemptAt).toBeGreaterThanOrEqual(now);
      expect(entry.nextAttemptAt).toBeLessThanOrEqual(after);
    }
  });

  it("maxQueueSize eviction: enqueuing a 3rd entry evicts the lowest-priority existing entry", async () => {
    const storage = createMemoryStorageAdapter();
    const engine = createQueueEngine({ storage, maxQueueSize: 2 });
    await engine.hydrate();

    await engine.enqueue(makeEnqueueInput({ priority: 5, event: makeEvent("low") }));
    await engine.enqueue(makeEnqueueInput({ priority: 10, event: makeEvent("high") }));
    expect(engine.size()).toBe(2);

    await engine.enqueue(makeEnqueueInput({ priority: 7, event: makeEvent("mid") }));

    expect(engine.size()).toBe(2);
    const names = engine.peekReady(Date.now() + 100000).map((e) => e.event.name);
    expect(names.sort()).toEqual(["high", "mid"]);
  });

  it("maxQueueSize eviction: ties on priority evict the older (enqueuedAt) entry", async () => {
    const storage = createMemoryStorageAdapter();
    const engine = createQueueEngine({ storage, maxQueueSize: 2 });
    await engine.hydrate();

    await engine.enqueue(makeEnqueueInput({ priority: 5, event: makeEvent("older") }));
    await engine.enqueue(makeEnqueueInput({ priority: 5, event: makeEvent("newer") }));
    await engine.enqueue(makeEnqueueInput({ priority: 5, event: makeEvent("newest") }));

    expect(engine.size()).toBe(2);
    const names = engine.peekReady(Date.now() + 100000).map((e) => e.event.name);
    expect(names.sort()).toEqual(["newer", "newest"]);
  });

  it("size() never exceeds maxQueueSize after any sequence of enqueues", async () => {
    const storage = createMemoryStorageAdapter();
    const engine = createQueueEngine({ storage, maxQueueSize: 3 });
    await engine.hydrate();

    for (let i = 0; i < 10; i++) {
      await engine.enqueue(makeEnqueueInput({ priority: i, event: makeEvent(`e${i}`) }));
      expect(engine.size()).toBeLessThanOrEqual(3);
    }
    expect(engine.size()).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// createQueueEngine -- peekReady
// ---------------------------------------------------------------------------

describe("createQueueEngine: peekReady", () => {
  it("excludes entries with nextAttemptAt > now, includes exactly those <= now", async () => {
    const storage = createMemoryStorageAdapter();
    const engine = createQueueEngine({ storage });
    await engine.hydrate();

    const now = 1_000_000;
    spyOn(Date, "now").mockReturnValue(now);
    await engine.enqueue(makeEnqueueInput({ event: makeEvent("ready") }));
    (Date.now as unknown as { mockRestore?: () => void }).mockRestore?.();

    expect(engine.peekReady(now - 1)).toEqual([]);
    expect(engine.peekReady(now)).toHaveLength(1);
    expect(engine.peekReady(now + 100)).toHaveLength(1);
  });

  it("orders by priority desc, then enqueuedAt asc within equal priority", async () => {
    const storage = createMemoryStorageAdapter();
    const engine = createQueueEngine({ storage });
    await engine.hydrate();

    await engine.enqueue(makeEnqueueInput({ priority: 1, event: makeEvent("low") }));
    await engine.enqueue(makeEnqueueInput({ priority: 10, event: makeEvent("high") }));
    await engine.enqueue(makeEnqueueInput({ priority: 1, event: makeEvent("low-later") }));
    await engine.enqueue(makeEnqueueInput({ priority: 5, event: makeEvent("mid") }));

    const names = engine.peekReady(Date.now() + 100000).map((e) => e.event.name);
    expect(names).toEqual(["high", "mid", "low", "low-later"]);
  });

  it("is read-only: does not mutate or persist", async () => {
    const storage = createMemoryStorageAdapter();
    const saveSpy = spyOn(storage, "save");
    const engine = createQueueEngine({ storage });
    await engine.hydrate();
    await engine.enqueue(makeEnqueueInput());
    saveSpy.mockClear();

    engine.peekReady(Date.now() + 100000);
    engine.peekReady(Date.now() + 100000);

    expect(saveSpy).not.toHaveBeenCalled();
    expect(engine.size()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// createQueueEngine -- recordFailure
// ---------------------------------------------------------------------------

describe("createQueueEngine: recordFailure", () => {
  it("below maxAttempts: increments attempts, sets nextAttemptAt via computeBackoffDelay, keeps entry", async () => {
    const storage = createMemoryStorageAdapter();
    const backoff = { baseMs: 100, factor: 2, maxMs: 10000 };
    const engine = createQueueEngine({ storage, maxAttempts: 5, backoff });
    await engine.hydrate();

    await engine.enqueue(makeEnqueueInput());
    const [entry] = engine.peekReady(Date.now() + 100000);
    expect(entry).toBeDefined();
    const id = (entry as PersistedQueueEntry).id;

    const now = 2_000_000;
    spyOn(Date, "now").mockReturnValue(now);
    await engine.recordFailure(id, new Error("boom"));
    (Date.now as unknown as { mockRestore?: () => void }).mockRestore?.();

    expect(engine.size()).toBe(1);
    const [updated] = engine.peekReady(now + computeBackoffDelay(1, backoff) + 1);
    expect(updated?.attempts).toBe(1);
    expect(updated?.nextAttemptAt).toBe(now + computeBackoffDelay(1, backoff));

    // Absent before the backoff has elapsed.
    expect(engine.peekReady(now + computeBackoffDelay(1, backoff) - 1)).toEqual([]);
    // Present once it has elapsed.
    expect(engine.peekReady(now + computeBackoffDelay(1, backoff))).toHaveLength(1);
  });

  it("reaching maxAttempts: removes entry, calls onDeadLetter once, and console.warn fires", async () => {
    const storage = createMemoryStorageAdapter();
    const warn = mock(() => {});
    console.warn = warn as unknown as typeof console.warn;
    const onDeadLetter = mock((_entry: PersistedQueueEntry, _reason: unknown) => {});

    const engine = createQueueEngine({ storage, maxAttempts: 1, onDeadLetter });
    await engine.hydrate();

    await engine.enqueue(makeEnqueueInput());
    const [entry] = engine.peekReady(Date.now() + 100000);
    const id = (entry as PersistedQueueEntry).id;

    const failureReason = new Error("permanent failure");
    await engine.recordFailure(id, failureReason);

    expect(engine.size()).toBe(0);
    expect(onDeadLetter).toHaveBeenCalledTimes(1);
    expect(onDeadLetter.mock.calls[0]?.[0]?.id).toBe(id);
    expect(onDeadLetter.mock.calls[0]?.[1]).toBe(failureReason);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// createQueueEngine -- recordSuccess
// ---------------------------------------------------------------------------

describe("createQueueEngine: recordSuccess", () => {
  it("removes the entry; subsequent peekReady/size() reflect the removal", async () => {
    const storage = createMemoryStorageAdapter();
    const engine = createQueueEngine({ storage });
    await engine.hydrate();

    await engine.enqueue(makeEnqueueInput({ event: makeEvent("a") }));
    await engine.enqueue(makeEnqueueInput({ event: makeEvent("b") }));
    const [first] = engine.peekReady(Date.now() + 100000);
    const id = (first as PersistedQueueEntry).id;

    await engine.recordSuccess(id);

    expect(engine.size()).toBe(1);
    const remaining = engine.peekReady(Date.now() + 100000);
    expect(remaining.find((e) => e.id === id)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// createQueueEngine -- hydrate
// ---------------------------------------------------------------------------

describe("createQueueEngine: hydrate", () => {
  it("populates the in-memory set from a pre-seeded storage adapter", async () => {
    const storage = createMemoryStorageAdapter();
    const seeded: PersistedQueueEntry = {
      id: "seed-1",
      providerName: "test-provider",
      verb: "track",
      event: makeEvent("seeded"),
      priority: 0,
      attempts: 0,
      enqueuedAt: Date.now(),
      nextAttemptAt: Date.now(),
    };
    await storage.save([seeded]);

    const engine = createQueueEngine({ storage });
    expect(engine.size()).toBe(0);
    await engine.hydrate();
    expect(engine.size()).toBe(1);
    expect(engine.peekReady(Date.now() + 100000)).toEqual([seeded]);
  });

  it("a storage.load() that rejects leaves the set empty and logs a warning rather than propagating", async () => {
    const warn = mock(() => {});
    console.warn = warn as unknown as typeof console.warn;

    const failingStorage: QueueStorageAdapter = {
      kind: "memory",
      load: () => Promise.reject(new Error("storage unavailable")),
      save: async () => {},
      clear: async () => {},
    };

    const engine = createQueueEngine({ storage: failingStorage });
    await expect(engine.hydrate()).resolves.toBeUndefined();
    expect(engine.size()).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// createQueueEngine -- clear
// ---------------------------------------------------------------------------

describe("createQueueEngine: clear", () => {
  it("empties the in-memory set and calls storage.clear()", async () => {
    const storage = createMemoryStorageAdapter();
    const clearSpy = spyOn(storage, "clear");
    const engine = createQueueEngine({ storage });
    await engine.hydrate();

    await engine.enqueue(makeEnqueueInput());
    await engine.clear();

    expect(engine.size()).toBe(0);
    expect(clearSpy).toHaveBeenCalledTimes(1);
    expect(await storage.load()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// createQueueEngine -- storage.save()/clear() called with correct state
// ---------------------------------------------------------------------------

describe("createQueueEngine: storage persistence", () => {
  it("every mutating method persists the correct resulting whole-array state", async () => {
    const storage = createMemoryStorageAdapter();
    const saveSpy = spyOn(storage, "save");
    const clearSpy = spyOn(storage, "clear");
    const engine = createQueueEngine({ storage, maxAttempts: 3 });
    await engine.hydrate();

    await engine.enqueue(makeEnqueueInput({ event: makeEvent("a") }));
    expect(saveSpy).toHaveBeenLastCalledWith(await storage.load());
    expect((await storage.load()).map((e) => e.event.name)).toEqual(["a"]);

    await engine.enqueue(makeEnqueueInput({ event: makeEvent("b") }));
    expect((await storage.load()).map((e) => e.event.name).sort()).toEqual(["a", "b"]);

    const [entryA] = (await storage.load()).filter((e) => e.event.name === "a");
    const idA = (entryA as PersistedQueueEntry).id;

    await engine.recordFailure(idA, new Error("fail once"));
    const persistedAfterFailure = await storage.load();
    expect(persistedAfterFailure.find((e) => e.id === idA)?.attempts).toBe(1);

    await engine.recordSuccess(idA);
    expect((await storage.load()).find((e) => e.id === idA)).toBeUndefined();

    await engine.clear();
    expect(clearSpy).toHaveBeenCalledTimes(1);
    expect(await storage.load()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Combined scenario
// ---------------------------------------------------------------------------

describe("createQueueEngine: combined scenario", () => {
  it("mixed priorities -> dead-letter one -> succeed another -> peekReady/size/storage consistent throughout", async () => {
    const storage = createMemoryStorageAdapter();
    const onDeadLetter = mock((_entry: PersistedQueueEntry, _reason: unknown) => {});
    const warn = mock(() => {});
    console.warn = warn as unknown as typeof console.warn;

    const engine: QueueEngine = createQueueEngine({
      storage,
      maxAttempts: 3,
      backoff: { baseMs: 10, factor: 2, maxMs: 1000 },
      onDeadLetter,
    });
    await engine.hydrate();

    // Enqueue 3 entries with mixed priorities.
    await engine.enqueue(makeEnqueueInput({ priority: 1, event: makeEvent("low-priority") }));
    await engine.enqueue(makeEnqueueInput({ priority: 10, event: makeEvent("high-priority") }));
    await engine.enqueue(makeEnqueueInput({ priority: 5, event: makeEvent("mid-priority") }));

    expect(engine.size()).toBe(3);
    let persisted = await storage.load();
    expect(persisted).toHaveLength(3);

    const now = Date.now();
    let ready = engine.peekReady(now + 1);
    expect(ready.map((e) => e.event.name)).toEqual(["high-priority", "mid-priority", "low-priority"]);

    const lowEntry = ready.find((e) => e.event.name === "low-priority") as PersistedQueueEntry;

    // Fail the low-priority entry repeatedly until dead-lettered
    // (maxAttempts: 3).
    let currentNow = now + 1;
    await engine.recordFailure(lowEntry.id, new Error("failure 1"));
    expect(engine.size()).toBe(3);
    persisted = await storage.load();
    expect(persisted.find((e) => e.id === lowEntry.id)?.attempts).toBe(1);

    // Wait past the backoff window before failing again.
    currentNow = now + 1 + computeBackoffDelay(1, { baseMs: 10, factor: 2, maxMs: 1000 }) + 1;
    expect(engine.peekReady(currentNow).map((e) => e.event.name).sort()).toEqual(
      ["high-priority", "low-priority", "mid-priority"].sort(),
    );

    await engine.recordFailure(lowEntry.id, new Error("failure 2"));
    expect(engine.size()).toBe(3);
    persisted = await storage.load();
    expect(persisted.find((e) => e.id === lowEntry.id)?.attempts).toBe(2);
    expect(onDeadLetter).not.toHaveBeenCalled();

    // Third failure reaches maxAttempts: 3 -> dead-lettered.
    await engine.recordFailure(lowEntry.id, new Error("failure 3 - fatal"));
    expect(engine.size()).toBe(2);
    persisted = await storage.load();
    expect(persisted.find((e) => e.id === lowEntry.id)).toBeUndefined();
    expect(onDeadLetter).toHaveBeenCalledTimes(1);
    expect(onDeadLetter.mock.calls[0]?.[0]?.id).toBe(lowEntry.id);
    expect(warn).toHaveBeenCalled();

    ready = engine.peekReady(currentNow + 100000);
    expect(ready.map((e) => e.event.name).sort()).toEqual(["high-priority", "mid-priority"]);

    // Succeed the mid-priority entry.
    const midEntry = ready.find((e) => e.event.name === "mid-priority") as PersistedQueueEntry;
    await engine.recordSuccess(midEntry.id);

    expect(engine.size()).toBe(1);
    persisted = await storage.load();
    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.event.name).toBe("high-priority");

    const final = engine.peekReady(currentNow + 100000);
    expect(final.map((e) => e.event.name)).toEqual(["high-priority"]);
  });
});
