"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const adapter_1 = require("./adapter");
const errors_1 = require("../errors");
const nock_1 = __importDefault(require("nock"));
(0, vitest_1.describe)('AnthropicAdapter Contract', () => {
    let adapter;
    const mockContext = {
        runId: 'test-run',
        logger: { log: async () => { } },
        retryOptions: { maxRetries: 0 },
    };
    (0, vitest_1.beforeEach)(() => {
        nock_1.default.cleanAll();
        nock_1.default.disableNetConnect(); // Ensure no real requests
        adapter = new adapter_1.AnthropicAdapter({
            type: 'anthropic',
            model: 'claude-3-opus-20240229',
            api_key: 'sk-ant-test-key',
        });
    });
    (0, vitest_1.afterEach)(() => {
        nock_1.default.cleanAll();
        nock_1.default.enableNetConnect();
    });
    (0, vitest_1.it)('sends correct request payload', async () => {
        const scope = (0, nock_1.default)('https://api.anthropic.com')
            .post('/v1/messages', (body) => {
            return (body.model === 'claude-3-opus-20240229' &&
                body.messages[0].content === 'Hi' &&
                body.max_tokens === 1024);
        })
            .reply(200, {
            id: 'msg_123',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: 'Hello there' }],
            usage: { input_tokens: 10, output_tokens: 5 },
        });
        const result = await adapter.generate({
            messages: [{ role: 'user', content: 'Hi' }],
        }, mockContext);
        (0, vitest_1.expect)(result.text).toBe('Hello there');
        (0, vitest_1.expect)(scope.isDone()).toBe(true);
    });
    (0, vitest_1.it)('handles 429 Rate Limit', async () => {
        (0, nock_1.default)('https://api.anthropic.com')
            .persist()
            .post('/v1/messages')
            .reply(429, {
            type: 'error',
            error: { type: 'rate_limit_error', message: 'Rate limit exceeded' },
        });
        await (0, vitest_1.expect)(adapter.generate({ messages: [{ role: 'user', content: 'Hi' }] }, mockContext)).rejects.toThrow(errors_1.RateLimitError);
    });
});
