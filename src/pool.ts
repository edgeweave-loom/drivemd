/**
 * Runs at most `size` tasks at a time, the others in the order they came. A
 * task whose signal aborts while it waits never runs: its query is no longer
 * wanted.
 */
export function pool(size: number) {
  let running = 0;
  const waiting: (() => void)[] = [];

  function turn(signal: AbortSignal | undefined): Promise<void> {
    return new Promise((start, stop) => {
      const go = () => {
        signal?.removeEventListener("abort", leave);
        start();
      };
      const leave = () => {
        waiting.splice(waiting.indexOf(go), 1);
        // An aborted signal's reason is an Error unless the caller chose
        // otherwise, and the pool's callers never do.
        stop(signal?.reason as Error);
      };
      waiting.push(go);
      signal?.addEventListener("abort", leave, { once: true });
    });
  }

  return async function run<T>(
    task: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    // A slot that frees goes to the task that waited longest.
    if (running < size) running += 1;
    else await turn(signal);
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else running -= 1;
    }
  };
}
