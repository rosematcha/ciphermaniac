export function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

/** A promise that never settles, like I/O canceled with the request that started it. */
export function never<T>(): Promise<T> {
  return new Promise<T>(() => {
    // Never settles.
  });
}
