// Phase 12 issue 002: queue engine -- priority ordering, exponential
// backoff, `maxQueueSize` eviction, and `maxAttempts` dead-lettering. Pure
// decision/orchestration logic operating against an injected
// `QueueStorageAdapter` (issue 001) -- no wiring into `createAnalytics()`
// yet (issue 003's job).
//
// In-memory working set is the source of truth during a session; storage is
// a durability mirror, not queried live on every operation. `hydrate()`
// reads storage once; every subsequent mutating call updates the in-memory
// set first, then mirrors it to storage. `peekReady`/`size()` never touch
// storage (cheap, synchronous).
import type { PersistedQueueEntry, QueueStorageAdapter } from "./storage";

// Options types don't self-default -- the resolver (`computeBackoffDelay`)
// or the engine constructor fills defaults in, mirroring Phase 11 issue
// 001's convention.
export interface BackoffOptions {
  baseMs?: number;
  factor?: number;
  maxMs?: number;
}

const DEFAULT_BACKOFF_BASE_MS = 1000;
const DEFAULT_BACKOFF_FACTOR = 2;
const DEFAULT_BACKOFF_MAX_MS = 30000;

// Pure: `min(maxMs, baseMs * factor ** attempts)`. `attempts` is the number
// of prior attempts (0 for the first retry after an initial failure).
export function computeBackoffDelay(attempts: number, options: BackoffOptions | undefined): number {
  const baseMs = options?.baseMs ?? DEFAULT_BACKOFF_BASE_MS;
  const factor = options?.factor ?? DEFAULT_BACKOFF_FACTOR;
  const maxMs = options?.maxMs ?? DEFAULT_BACKOFF_MAX_MS;
  return Math.min(maxMs, baseMs * factor ** attempts);
}

export interface QueueEngineOptions {
  storage: QueueStorageAdapter;
  maxQueueSize?: number;
  maxAttempts?: number;
  backoff?: BackoffOptions;
  onDeadLetter?: (entry: PersistedQueueEntry, reason: unknown) => void;
}

const DEFAULT_MAX_QUEUE_SIZE = 100;
const DEFAULT_MAX_ATTEMPTS = 5;

export interface QueueEngine {
  hydrate(): Promise<void>;
  enqueue(
    entry: Omit<PersistedQueueEntry, "id" | "attempts" | "enqueuedAt" | "nextAttemptAt">,
  ): Promise<void>;
  peekReady(now: number): PersistedQueueEntry[];
  recordSuccess(id: string): Promise<void>;
  recordFailure(id: string, error: unknown): Promise<void>;
  size(): number;
  clear(): Promise<void>;
}

let nextId = 0;

// Generates a locally-unique id for a freshly enqueued entry. A monotonic
// counter plus a random suffix is enough for this in-process engine (ids
// only ever need to be unique within a single engine instance's lifetime;
// there's no cross-process/cross-tab coordination requirement here).
function generateEntryId(): string {
  nextId += 1;
  return `q-${Date.now().toString(36)}-${nextId}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createQueueEngine(options: QueueEngineOptions): QueueEngine {
  const storage = options.storage;
  const maxQueueSize = options.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const backoff = options.backoff;
  const onDeadLetter = options.onDeadLetter;

  let entries: PersistedQueueEntry[] = [];

  // Evicts the lowest-priority, then oldest (`enqueuedAt`), entry until
  // `entries` has room for one more, given `maxQueueSize`. For
  // `maxQueueSize >= 1` this is always exactly one eviction per over-limit
  // enqueue since entries are added one at a time.
  function evictIfNeeded(): void {
    while (entries.length > maxQueueSize) {
      let evictIndex = 0;
      for (let i = 1; i < entries.length; i++) {
        const candidate = entries[i] as PersistedQueueEntry;
        const current = entries[evictIndex] as PersistedQueueEntry;
        if (
          candidate.priority < current.priority ||
          (candidate.priority === current.priority && candidate.enqueuedAt < current.enqueuedAt)
        ) {
          evictIndex = i;
        }
      }
      entries.splice(evictIndex, 1);
    }
  }

  return {
    async hydrate() {
      try {
        entries = await storage.load();
      } catch (err) {
        entries = [];
        console.warn("typetrack: failed to hydrate queue from storage", err);
      }
    },

    async enqueue(entry) {
      const now = Date.now();
      const fullEntry: PersistedQueueEntry = {
        ...entry,
        id: generateEntryId(),
        attempts: 0,
        enqueuedAt: now,
        nextAttemptAt: now,
      };

      entries.push(fullEntry);
      evictIfNeeded();
      await storage.save(entries.slice());
    },

    peekReady(now) {
      return entries
        .filter((entry) => entry.nextAttemptAt <= now)
        .sort((a, b) => {
          if (a.priority !== b.priority) {
            return b.priority - a.priority;
          }
          return a.enqueuedAt - b.enqueuedAt;
        });
    },

    async recordSuccess(id) {
      entries = entries.filter((entry) => entry.id !== id);
      await storage.save(entries.slice());
    },

    async recordFailure(id, error) {
      const index = entries.findIndex((entry) => entry.id === id);
      if (index === -1) {
        return;
      }

      const entry = entries[index] as PersistedQueueEntry;
      const attempts = entry.attempts + 1;

      if (attempts >= maxAttempts) {
        entries.splice(index, 1);
        console.warn(
          `typetrack: dropping queued event after ${attempts} failed attempts (provider "${entry.providerName}", event "${entry.event.name}")`,
          error,
        );
        onDeadLetter?.(entry, error);
      } else {
        const nextAttemptAt = Date.now() + computeBackoffDelay(attempts, backoff);
        entries[index] = { ...entry, attempts, nextAttemptAt };
      }

      await storage.save(entries.slice());
    },

    size() {
      return entries.length;
    },

    async clear() {
      entries = [];
      await storage.clear();
    },
  };
}
