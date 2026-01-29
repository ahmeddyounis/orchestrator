import { AdapterContext, RetryOptions } from '../types';
import { RateLimitError, TimeoutError, ConfigError } from '../errors';

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffFactor: 2,
};

function isRetriableError(error: unknown): boolean {
  // Check for specific error types
  if (error instanceof RateLimitError || error instanceof TimeoutError) {
    return true;
  }
  
  // Check for status codes (common in SDKs)
  const status = (error as { status?: number; statusCode?: number })?.status || (error as { status?: number; statusCode?: number })?.statusCode;
  if (typeof status === 'number') {
    // 429: Too Many Requests
    // 500: Internal Server Error
    // 502: Bad Gateway
    // 503: Service Unavailable
    // 504: Gateway Timeout
    return status === 429 || (status >= 500 && status < 600);
  }

  // Check for fetch/network errors
  const code = (error as { code?: string; cause?: { code?: string } })?.code || (error as { code?: string; cause?: { code?: string } })?.cause?.code;
  if (code === 'ETIMEDOUT' || code === 'ECONNRESET' || code === 'ECONNREFUSED') {
    return true;
  }

  return false;
}

export async function executeProviderRequest<T>(
  ctx: AdapterContext,
  provider: string,
  model: string,
  requestFn: (signal: AbortSignal) => Promise<T>,
  optionsOverride: RetryOptions = {}
): Promise<T> {
  const { maxRetries, initialDelayMs, maxDelayMs, backoffFactor } = {
    ...DEFAULT_OPTIONS,
    ...ctx.retryOptions,
    ...optionsOverride,
  };

  const startTime = Date.now();
  
  await ctx.logger.log({
    type: 'ProviderRequestStarted',
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    runId: ctx.runId,
    payload: {
      provider,
      model,
    },
  });

  let attempts = 0;
  let lastError: unknown;

  while (attempts <= maxRetries) {
    const abortController = new AbortController();
    
    // Handle user cancellation
    const abortHandler = () => {
      abortController.abort();
    };

    if (ctx.abortSignal) {
      if (ctx.abortSignal.aborted) {
        abortController.abort();
      } else {
        ctx.abortSignal.addEventListener('abort', abortHandler);
      }
    }

    // Handle timeout
    let timeoutId: NodeJS.Timeout | undefined;
    if (ctx.timeoutMs) {
      timeoutId = setTimeout(() => {
        abortController.abort(new TimeoutError(`Request timed out after ${ctx.timeoutMs}ms`));
      }, ctx.timeoutMs);
    }

    try {
      const result = await requestFn(abortController.signal);
      
      // Clear timeout
      if (timeoutId) clearTimeout(timeoutId);
      if (ctx.abortSignal) ctx.abortSignal.removeEventListener('abort', abortHandler);

      const durationMs = Date.now() - startTime;
      await ctx.logger.log({
        type: 'ProviderRequestFinished',
        schemaVersion: 1,
        timestamp: new Date().toISOString(),
        runId: ctx.runId,
        payload: {
          provider,
          durationMs,
          success: true,
          retries: attempts,
        },
      });

      return result;
    } catch (error: unknown) {
      // Clear timeout
      if (timeoutId) clearTimeout(timeoutId);
      if (ctx.abortSignal) ctx.abortSignal.removeEventListener('abort', abortHandler);

      lastError = error;
      
      // Don't retry if aborted by user
      if (ctx.abortSignal?.aborted) {
        throw error; // Let the AbortError propagate
      }
      
      // Don't retry config errors (401, etc)
      if (error instanceof ConfigError) {
        break;
      }

      const retriable = isRetriableError(error);
      if (!retriable || attempts >= maxRetries) {
        break;
      }

      attempts++;
      
      // Calculate delay with jitter
      const delay = Math.min(
        maxDelayMs,
        initialDelayMs * Math.pow(backoffFactor, attempts - 1)
      );
      const jitter = delay * 0.1 * (Math.random() * 2 - 1); // +/- 10%
      const finalDelay = Math.max(0, delay + jitter);

      await new Promise((resolve) => setTimeout(resolve, finalDelay));
    }
  }

  const durationMs = Date.now() - startTime;
  await ctx.logger.log({
    type: 'ProviderRequestFinished',
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    runId: ctx.runId,
    payload: {
      provider,
      durationMs,
      success: false,
      error: (lastError instanceof Error) ? lastError.message : String(lastError),
      retries: attempts,
    },
  });

  throw lastError;
}
