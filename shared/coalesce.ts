/**
 * Concurrent identical reads share one round trip; settled reads are never retained.
 *
 * A Worker cancels a request's outstanding I/O when its client disconnects,
 * which can leave a shared read pending forever. So a read is only joined
 * while it is younger than `joinMs`, and a joiner still waiting at that point
 * stops and reads for itself.
 * @module shared/coalesce
 */

const MAX_PENDING = 256;
const DEFAULT_JOIN_MS = 2000;

interface Pending<T> {
  result: Promise<T>;
  startedAt: number;
}

function pruneStale<T>(reads: Map<string, Pending<T>>, oldest: number): void {
  for (const [key, entry] of reads) {
    if (entry.startedAt <= oldest) {
      reads.delete(key);
    }
  }
}

/** The shared result, or this caller's own read if the shared one is still pending at `waitMs`. */
function joinOrRead<T>(shared: Promise<T>, read: () => Promise<T>, waitMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const own = new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => {
      read().then(resolve, reject);
    }, waitMs);
  });
  return Promise.race([shared, own]).finally(() => clearTimeout(timer));
}

export function coalescedRead<T>(joinMs = DEFAULT_JOIN_MS) {
  const bindings = new WeakMap<object, Map<string, Pending<T>>>();

  return (binding: object, key: string, read: () => Promise<T>): Promise<T> => {
    let reads = bindings.get(binding);
    if (!reads) {
      reads = new Map();
      bindings.set(binding, reads);
    }
    const now = Date.now();
    const held = reads.get(key);
    if (held && now - held.startedAt < joinMs) {
      return joinOrRead(held.result, read, held.startedAt + joinMs - now);
    }
    if (reads.size >= MAX_PENDING) {
      pruneStale(reads, now - joinMs);
    }
    if (reads.size >= MAX_PENDING) {
      return read();
    }
    const entry = { result: Promise.resolve().then(read), startedAt: now };
    const owned = reads;
    const release = () => {
      if (owned.get(key) === entry) {
        owned.delete(key);
      }
    };
    entry.result.then(release, release);
    reads.set(key, entry);
    return entry.result;
  };
}
