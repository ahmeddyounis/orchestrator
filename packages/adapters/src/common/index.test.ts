import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { executeProviderRequest } from './index';
import { AdapterContext } from '../types';
import { RateLimitError, ConfigError, TimeoutError } from '../errors';

describe('executeProviderRequest', () => {
  let ctx: AdapterContext;
  let logSpy: Mock;

  beforeEach(() => {
    logSpy = vi.fn().mockResolvedValue(undefined);
    ctx = {
      runId: 'test-run',
      logger: { log: logSpy },
    };
  });

  it('should execute successfully without retries', async () => {
    const fn = vi.fn().mockResolvedValue('success');
    
    const result = await executeProviderRequest(ctx, 'test', 'model', fn);
    
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'ProviderRequestStarted' }));
    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'ProviderRequestFinished', payload: expect.objectContaining({ success: true }) }));
  });

  it('should retry on retriable error', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new RateLimitError('Limit reached'))
      .mockResolvedValue('success');
    
    const result = await executeProviderRequest(ctx, 'test', 'model', fn, { initialDelayMs: 1 });
    
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({ 
        type: 'ProviderRequestFinished', 
        payload: expect.objectContaining({ success: true, retries: 1 }) 
    }));
  });

  it('should fail after max retries', async () => {
    const fn = vi.fn().mockRejectedValue(new RateLimitError('Limit reached'));
    
    await expect(executeProviderRequest(ctx, 'test', 'model', fn, { maxRetries: 2, initialDelayMs: 1 }))
      .rejects.toThrow(RateLimitError);
    
    expect(fn).toHaveBeenCalledTimes(3); // Initial + 2 retries
    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({ 
        type: 'ProviderRequestFinished', 
        payload: expect.objectContaining({ success: false, retries: 2 }) 
    }));
  });

  it('should not retry on non-retriable error', async () => {
    const fn = vi.fn().mockRejectedValue(new ConfigError('Bad config'));
    
    await expect(executeProviderRequest(ctx, 'test', 'model', fn))
      .rejects.toThrow(ConfigError);
    
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should handle timeouts', async () => {
    ctx.timeoutMs = 10;
    const fn = vi.fn().mockImplementation(async (signal: AbortSignal) => {
      return new Promise((resolve, reject) => {
         const timeout = setTimeout(resolve, 50);
         signal.addEventListener('abort', () => {
            clearTimeout(timeout);
            reject(signal.reason);
         });
      });
    });

    await expect(executeProviderRequest(ctx, 'test', 'model', fn, { maxRetries: 1, initialDelayMs: 1 }))
      .rejects.toThrow(TimeoutError);

    // Should retry on timeout? Yes.
    // Initial attempt (fail) + 1 retry (fail) = 2 calls
    // But wait, checking logic:
    // TimeoutError is retriable.
    // So it should be called twice if maxRetries=1.
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should respect abort signal', async () => {
    const controller = new AbortController();
    ctx.abortSignal = controller.signal;
    
    const fn = vi.fn().mockImplementation(async (signal: AbortSignal) => {
        return new Promise((resolve, reject) => {
            if (signal.aborted) return reject(signal.reason);
            signal.addEventListener('abort', () => reject(signal.reason));
        });
    });

    const promise = executeProviderRequest(ctx, 'test', 'model', fn);
    setTimeout(() => controller.abort(), 10);
    
    await expect(promise).rejects.toThrow(); // AbortError
    // Should NOT retry if aborted by user
    expect(fn).toHaveBeenCalledTimes(1);
  });
});