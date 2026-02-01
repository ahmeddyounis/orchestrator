"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const index_1 = require("./index");
const errors_1 = require("../errors");
(0, vitest_1.describe)('executeProviderRequest', () => {
    let ctx;
    let logSpy;
    (0, vitest_1.beforeEach)(() => {
        logSpy = vitest_1.vi.fn().mockResolvedValue(undefined);
        ctx = {
            runId: 'test-run',
            logger: { log: logSpy },
        };
    });
    (0, vitest_1.it)('should execute successfully without retries', async () => {
        const fn = vitest_1.vi.fn().mockResolvedValue('success');
        const result = await (0, index_1.executeProviderRequest)(ctx, 'test', 'model', fn);
        (0, vitest_1.expect)(result).toBe('success');
        (0, vitest_1.expect)(fn).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(logSpy).toHaveBeenCalledWith(vitest_1.expect.objectContaining({ type: 'ProviderRequestStarted' }));
        (0, vitest_1.expect)(logSpy).toHaveBeenCalledWith(vitest_1.expect.objectContaining({
            type: 'ProviderRequestFinished',
            payload: vitest_1.expect.objectContaining({ success: true }),
        }));
    });
    (0, vitest_1.it)('should retry on retriable error', async () => {
        const fn = vitest_1.vi
            .fn()
            .mockRejectedValueOnce(new errors_1.RateLimitError('Limit reached'))
            .mockResolvedValue('success');
        const result = await (0, index_1.executeProviderRequest)(ctx, 'test', 'model', fn, { initialDelayMs: 1 });
        (0, vitest_1.expect)(result).toBe('success');
        (0, vitest_1.expect)(fn).toHaveBeenCalledTimes(2);
        (0, vitest_1.expect)(logSpy).toHaveBeenCalledWith(vitest_1.expect.objectContaining({
            type: 'ProviderRequestFinished',
            payload: vitest_1.expect.objectContaining({ success: true, retries: 1 }),
        }));
    });
    (0, vitest_1.it)('should fail after max retries', async () => {
        const fn = vitest_1.vi.fn().mockRejectedValue(new errors_1.RateLimitError('Limit reached'));
        await (0, vitest_1.expect)((0, index_1.executeProviderRequest)(ctx, 'test', 'model', fn, { maxRetries: 2, initialDelayMs: 1 })).rejects.toThrow(errors_1.RateLimitError);
        (0, vitest_1.expect)(fn).toHaveBeenCalledTimes(3); // Initial + 2 retries
        (0, vitest_1.expect)(logSpy).toHaveBeenCalledWith(vitest_1.expect.objectContaining({
            type: 'ProviderRequestFinished',
            payload: vitest_1.expect.objectContaining({ success: false, retries: 2 }),
        }));
    });
    (0, vitest_1.it)('should not retry on non-retriable error', async () => {
        const fn = vitest_1.vi.fn().mockRejectedValue(new errors_1.ConfigError('Bad config'));
        await (0, vitest_1.expect)((0, index_1.executeProviderRequest)(ctx, 'test', 'model', fn)).rejects.toThrow(errors_1.ConfigError);
        (0, vitest_1.expect)(fn).toHaveBeenCalledTimes(1);
    });
    (0, vitest_1.it)('should handle timeouts', async () => {
        ctx.timeoutMs = 10;
        const fn = vitest_1.vi.fn().mockImplementation(async (signal) => {
            return new Promise((resolve, reject) => {
                const timeout = setTimeout(resolve, 50);
                signal.addEventListener('abort', () => {
                    clearTimeout(timeout);
                    reject(signal.reason);
                });
            });
        });
        await (0, vitest_1.expect)((0, index_1.executeProviderRequest)(ctx, 'test', 'model', fn, { maxRetries: 1, initialDelayMs: 1 })).rejects.toThrow(errors_1.TimeoutError);
        // Should retry on timeout? Yes.
        // Initial attempt (fail) + 1 retry (fail) = 2 calls
        // But wait, checking logic:
        // TimeoutError is retriable.
        // So it should be called twice if maxRetries=1.
        (0, vitest_1.expect)(fn).toHaveBeenCalledTimes(2);
    });
    (0, vitest_1.it)('should respect abort signal', async () => {
        const controller = new AbortController();
        ctx.abortSignal = controller.signal;
        const fn = vitest_1.vi.fn().mockImplementation(async (signal) => {
            return new Promise((resolve, reject) => {
                if (signal.aborted)
                    return reject(signal.reason);
                signal.addEventListener('abort', () => reject(signal.reason));
            });
        });
        const promise = (0, index_1.executeProviderRequest)(ctx, 'test', 'model', fn);
        setTimeout(() => controller.abort(), 10);
        await (0, vitest_1.expect)(promise).rejects.toThrow(); // AbortError
        // Should NOT retry if aborted by user
        (0, vitest_1.expect)(fn).toHaveBeenCalledTimes(1);
    });
});
