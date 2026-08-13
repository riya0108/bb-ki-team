import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage<AbortSignal>();

export class CancelledError extends Error {
  constructor(message = 'Run was cancelled') {
    super(message);
    this.name = 'CancelledError';
  }
}

/**
 * Makes `signal` available to every LLM call beneath `fn` (via
 * getCancellationSignal()) without threading it through every agent
 * pipeline's function signature. apps/worker wraps each dispatched task in
 * this so a human clicking "stop" aborts in-flight LLM calls and halts the
 * pipeline before its next stage, wherever in the call stack it currently is.
 */
export function runWithCancellation<T>(signal: AbortSignal, fn: () => Promise<T>): Promise<T> {
  return storage.run(signal, fn);
}

export function getCancellationSignal(): AbortSignal | undefined {
  return storage.getStore();
}

/** Call before starting an expensive step (LLM call, search) so a cancelled run stops promptly instead of paying for work nobody will see. */
export function throwIfCancelled(): void {
  if (getCancellationSignal()?.aborted) throw new CancelledError();
}
