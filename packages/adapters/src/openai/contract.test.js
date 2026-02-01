"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const adapter_1 = require("./adapter");
const errors_1 = require("../errors");
const nock_1 = __importDefault(require("nock"));
(0, vitest_1.describe)('OpenAIAdapter Contract', () => {
    let adapter;
    const mockContext = {
        runId: 'test-run',
        logger: { log: async () => { } },
        retryOptions: { maxRetries: 0 },
    };
    (0, vitest_1.beforeEach)(() => {
        nock_1.default.cleanAll();
        nock_1.default.disableNetConnect();
        adapter = new adapter_1.OpenAIAdapter({
            type: 'openai',
            model: 'gpt-4',
            api_key: 'sk-openai-test-key',
        });
    });
    (0, vitest_1.afterEach)(() => {
        nock_1.default.cleanAll();
        nock_1.default.enableNetConnect();
    });
    (0, vitest_1.it)('sends correct request payload', async () => {
        const scope = (0, nock_1.default)('https://api.openai.com')
            .post('/v1/chat/completions', (body) => {
            return body.model === 'gpt-4' && body.messages[0].content === 'Hi';
        })
            .reply(200, {
            id: 'chatcmpl-123',
            object: 'chat.completion',
            created: 1677652288,
            model: 'gpt-4',
            choices: [
                {
                    index: 0,
                    message: {
                        role: 'assistant',
                        content: 'Hello there',
                    },
                    finish_reason: 'stop',
                },
            ],
            usage: {
                prompt_tokens: 10,
                completion_tokens: 5,
                total_tokens: 15,
            },
        });
        const result = await adapter.generate({
            messages: [{ role: 'user', content: 'Hi' }],
        }, mockContext);
        (0, vitest_1.expect)(result.text).toBe('Hello there');
        (0, vitest_1.expect)(scope.isDone()).toBe(true);
    });
    (0, vitest_1.it)('handles 429 Rate Limit', async () => {
        (0, nock_1.default)('https://api.openai.com')
            .persist()
            .post('/v1/chat/completions')
            .reply(429, {
            error: {
                message: 'Rate limit exceeded',
                type: 'requests',
                param: null,
                code: null,
            },
        });
        await (0, vitest_1.expect)(adapter.generate({ messages: [{ role: 'user', content: 'Hi' }] }, mockContext)).rejects.toThrow(errors_1.RateLimitError);
    });
});
