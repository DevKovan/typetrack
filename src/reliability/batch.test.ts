// Unit tests for `src/reliability/batch.ts`'s `chunkForBatching()` (Phase
// 12 issue 005). Pure logic, no I/O, no queue engine/storage/provider
// involved -- isolated from the full `drainQueueOnce()` integration path,
// which has its own tests in `src/index.test.ts`.
import { describe, expect, it } from "bun:test";
import { chunkForBatching } from "./batch";
import type { PersistedQueueEntry } from "./storage";
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

function makeEntry(overrides: Partial<PersistedQueueEntry> = {}): PersistedQueueEntry {
  return {
    id: `entry-${Math.random().toString(36).slice(2, 8)}`,
    providerName: "test-provider",
    verb: "track",
    event: makeEvent(),
    priority: 0,
    attempts: 0,
    enqueuedAt: 0,
    nextAttemptAt: 0,
    ...overrides,
  };
}

describe("chunkForBatching", () => {
  it("returns [] for an empty input", () => {
    expect(chunkForBatching([], 10, 5000, 1000)).toEqual([]);
  });

  it("a group already >= batchSize is chunked immediately, regardless of age", () => {
    const entries = [
      makeEntry({ id: "a", enqueuedAt: 1000 }),
      makeEntry({ id: "b", enqueuedAt: 1000 }),
      makeEntry({ id: "c", enqueuedAt: 1000 }),
    ];
    // now === enqueuedAt: zero elapsed time, but the group size (3) already
    // meets batchSize (3), so it's sent immediately.
    const chunks = chunkForBatching(entries, 3, 5000, 1000);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toHaveLength(3);
    expect(chunks[0]!.map((e) => e.id)).toEqual(["a", "b", "c"]);
  });

  it("splits a group larger than batchSize into chunks of at most batchSize, preserving order (size 2 chunking of 5 entries -> 2, 2, 1)", () => {
    const entries = ["a", "b", "c", "d", "e"].map((id) => makeEntry({ id, enqueuedAt: 1000 }));
    const chunks = chunkForBatching(entries, 2, 5000, 1000);
    expect(chunks).toHaveLength(3);
    expect(chunks.map((c) => c.length)).toEqual([2, 2, 1]);
    expect(chunks[0]!.map((e) => e.id)).toEqual(["a", "b"]);
    expect(chunks[1]!.map((e) => e.id)).toEqual(["c", "d"]);
    expect(chunks[2]!.map((e) => e.id)).toEqual(["e"]);
  });

  it("a partial group (below batchSize) whose oldest entry has NOT yet waited intervalMs is left un-batched ([])", () => {
    const entries = [makeEntry({ id: "a", enqueuedAt: 1000 }), makeEntry({ id: "b", enqueuedAt: 1500 })];
    // batchSize 10 (not met by 2 entries); now - oldest(1000) = 4000ms < intervalMs (5000).
    const chunks = chunkForBatching(entries, 10, 5000, 5000);
    expect(chunks).toEqual([]);
  });

  it("a partial group whose oldest entry HAS waited >= intervalMs is sent as one (possibly partial) chunk", () => {
    const entries = [makeEntry({ id: "a", enqueuedAt: 1000 }), makeEntry({ id: "b", enqueuedAt: 1500 })];
    // now - oldest(1000) = 5000ms >= intervalMs (5000) -- exactly at the
    // threshold counts as "elapsed".
    const chunks = chunkForBatching(entries, 10, 5000, 6000);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("uses the minimum enqueuedAt across the group (oldest entry), not the first array element, to evaluate the age check", () => {
    // "b" (index 0) is younger than "a" (index 1) -- the oldest is "a".
    const entries = [makeEntry({ id: "b", enqueuedAt: 4000 }), makeEntry({ id: "a", enqueuedAt: 1000 })];
    // now - oldest(1000) = 5000ms >= intervalMs (5000) -> should batch.
    const chunks = chunkForBatching(entries, 10, 5000, 6000);
    expect(chunks).toHaveLength(1);

    // now - oldest(1000) = 4000ms < intervalMs (5000) -> should not batch,
    // even though "b" (4000) would individually have satisfied it if it were
    // (incorrectly) treated as the "oldest".
    const notYet = chunkForBatching(entries, 10, 5000, 5000);
    expect(notYet).toEqual([]);
  });

  it("a single-entry group below batchSize and not yet old enough returns []", () => {
    const entries = [makeEntry({ id: "a", enqueuedAt: 1000 })];
    expect(chunkForBatching(entries, 10, 5000, 2000)).toEqual([]);
  });

  it("a single-entry group whose age has elapsed still comes back as one chunk of size 1 (this function has no size->1 special case; callers gate that decision themselves before calling in)", () => {
    const entries = [makeEntry({ id: "a", enqueuedAt: 1000 })];
    expect(chunkForBatching(entries, 10, 5000, 6000)).toEqual([entries]);
  });
});
