export interface RetryOptions {
  retries: number;
  initialDelayMs: number;
  factor?: number;
  maxDelayMs?: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function retryWithBackoff<T>(operation: () => Promise<T>, options: RetryOptions): Promise<T> {
  const retries = Math.max(0, options.retries);
  const factor = options.factor ?? 2;
  const maxDelayMs = options.maxDelayMs ?? Number.POSITIVE_INFINITY;

  let delayMs = Math.max(0, options.initialDelayMs);
  let lastError: unknown;

  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const canRetry = attempt <= retries && (options.shouldRetry ? options.shouldRetry(error, attempt) : true);
      if (!canRetry) {
        throw error;
      }

      await sleep(Math.min(delayMs, maxDelayMs));
      delayMs = Math.min(Math.ceil(delayMs * factor), maxDelayMs);
    }
  }

  throw lastError;
}
