import { ProcessingError } from "./types.ts";
// Acquire before reserving/consuming quota so cancelled waiters cost no units.
export function createSummaryGate(limit: number) {
  if (!Number.isInteger(limit) || limit < 1)
    throw new Error("Invalid summary concurrency");
  let active = 0;
  const waiting: (() => void)[] = [];
  return async (signal: AbortSignal): Promise<() => void> => {
    while (active >= limit) {
      await new Promise<void>((resolve, reject) => {
        const wake = () => {
          signal.removeEventListener("abort", abort);
          resolve();
        };
        const abort = () => {
          const index = waiting.indexOf(wake);
          if (index >= 0) waiting.splice(index, 1);
          reject(new ProcessingError("SUMMARY_CANCELLED"));
        };
        if (signal.aborted) {
          abort();
          return;
        }
        waiting.push(wake);
        signal.addEventListener("abort", abort, { once: true });
      });
    }
    signal.throwIfAborted();
    active++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      active--;
      waiting.shift()?.();
    };
  };
}
