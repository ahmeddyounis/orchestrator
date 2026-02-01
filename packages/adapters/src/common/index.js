'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.executeProviderRequest = executeProviderRequest;
const errors_1 = require('../errors');
const DEFAULT_OPTIONS = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffFactor: 2,
};
function isRetriableError(error) {
  // Check for specific error types
  if (error instanceof errors_1.RateLimitError || error instanceof errors_1.TimeoutError) {
    return true;
  }
  // Check for status codes (common in SDKs)
  const status = error?.status || error?.statusCode;
  if (typeof status === 'number') {
    // 429: Too Many Requests
    // 500: Internal Server Error
    // 502: Bad Gateway
    // 503: Service Unavailable
    // 504: Gateway Timeout
    return status === 429 || (status >= 500 && status < 600);
  }
  // Check for fetch/network errors
  const code = error?.code || error?.cause?.code;
  if (code === 'ETIMEDOUT' || code === 'ECONNRESET' || code === 'ECONNREFUSED') {
    return true;
  }
  return false;
}
async function executeProviderRequest(ctx, provider, model, requestFn, optionsOverride = {}) {
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
  let lastError;
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
    let timeoutId;
    if (ctx.timeoutMs) {
      timeoutId = setTimeout(() => {
        abortController.abort(
          new errors_1.TimeoutError(`Request timed out after ${ctx.timeoutMs}ms`),
        );
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
    } catch (error) {
      // Clear timeout
      if (timeoutId) clearTimeout(timeoutId);
      if (ctx.abortSignal) ctx.abortSignal.removeEventListener('abort', abortHandler);
      lastError = error;
      // Don't retry if aborted by user
      if (ctx.abortSignal?.aborted) {
        throw error; // Let the AbortError propagate
      }
      // Don't retry config errors (401, etc)
      if (error instanceof errors_1.ConfigError) {
        break;
      }
      const retriable = isRetriableError(error);
      if (!retriable || attempts >= maxRetries) {
        break;
      }
      attempts++;
      // Calculate delay with jitter
      const delay = Math.min(maxDelayMs, initialDelayMs * Math.pow(backoffFactor, attempts - 1));
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
      error: lastError instanceof Error ? lastError.message : String(lastError),
      retries: attempts,
    },
  });
  throw lastError;
}
//# sourceMappingURL=index.js.map
