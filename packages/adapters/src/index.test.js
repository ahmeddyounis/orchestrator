"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
class MockAdapter {
    id() {
        return 'mock-adapter';
    }
    capabilities() {
        return {
            supportsStreaming: true,
            supportsToolCalling: true,
            supportsJsonMode: true,
            modality: 'text',
            latencyClass: 'fast',
        };
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async generate(_req, _ctx) {
        return {
            text: 'Mock response',
            usage: {
                inputTokens: 10,
                outputTokens: 5,
                totalTokens: 15,
            },
        };
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async *stream(_req, _ctx) {
        yield { type: 'text-delta', content: 'Mock' };
        yield { type: 'text-delta', content: ' ' };
        yield { type: 'text-delta', content: 'response' };
        yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } };
    }
}
(0, vitest_1.describe)('ProviderAdapter Interface', () => {
    (0, vitest_1.it)('should be implementable', async () => {
        const adapter = new MockAdapter();
        (0, vitest_1.expect)(adapter.id()).toBe('mock-adapter');
        (0, vitest_1.expect)(adapter.capabilities().supportsStreaming).toBe(true);
        const mockLogger = {
            log: async () => { },
        };
        const ctx = {
            runId: 'test-run',
            logger: mockLogger,
        };
        const response = await adapter.generate({ messages: [] }, ctx);
        (0, vitest_1.expect)(response.text).toBe('Mock response');
        const stream = adapter.stream({ messages: [] }, ctx);
        const events = [];
        for await (const event of stream) {
            events.push(event);
        }
        (0, vitest_1.expect)(events.length).toBe(4);
        (0, vitest_1.expect)(events[0]).toEqual({ type: 'text-delta', content: 'Mock' });
    });
});
//# sourceMappingURL=index.test.js.map