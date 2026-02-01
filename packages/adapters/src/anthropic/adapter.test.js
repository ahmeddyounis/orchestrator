"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const adapter_1 = require("./adapter");
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const errors_1 = require("../errors");
const mockCreate = vitest_1.vi.fn();
vitest_1.vi.mock('@anthropic-ai/sdk', () => {
    const MockAnthropic = class {
        messages = {
            create: mockCreate,
        };
    };
    // Attach static error classes to the mock class
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    MockAnthropic.APIError = class extends Error {
        status;
        constructor(status, message) {
            super(message || 'API Error');
            this.status = status || 500;
        }
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    MockAnthropic.APIConnectionTimeoutError = class extends Error {
    };
    return {
        default: MockAnthropic,
    };
});
(0, vitest_1.describe)('AnthropicAdapter', () => {
    let adapter;
    const mockContext = {
        runId: 'test-run',
        logger: { log: vitest_1.vi.fn().mockResolvedValue(undefined) },
        retryOptions: { maxRetries: 0 },
    };
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
        adapter = new adapter_1.AnthropicAdapter({
            type: 'anthropic',
            model: 'claude-3-opus-20240229',
            api_key: 'test-key',
        });
    });
    (0, vitest_1.it)('generate returns text and usage', async () => {
        mockCreate.mockResolvedValue({
            content: [{ type: 'text', text: 'Hello' }],
            usage: { input_tokens: 10, output_tokens: 5 },
        });
        const result = await adapter.generate({
            messages: [{ role: 'user', content: 'Hi' }],
        }, mockContext);
        (0, vitest_1.expect)(result.text).toBe('Hello');
        (0, vitest_1.expect)(result.usage).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
        (0, vitest_1.expect)(mockCreate).toHaveBeenCalledWith(vitest_1.expect.objectContaining({
            model: 'claude-3-opus-20240229',
            messages: [{ role: 'user', content: 'Hi' }],
            max_tokens: 1024,
        }), vitest_1.expect.anything());
    });
    (0, vitest_1.it)('generate handles tool calls', async () => {
        mockCreate.mockResolvedValue({
            content: [
                { type: 'text', text: 'Thinking...' },
                {
                    type: 'tool_use',
                    id: 'call_1',
                    name: 'get_weather',
                    input: { location: 'London' },
                },
            ],
            usage: { input_tokens: 10, output_tokens: 5 },
        });
        const result = await adapter.generate({
            messages: [{ role: 'user', content: 'Weather?' }],
            tools: [{ name: 'get_weather', inputSchema: {} }],
        }, mockContext);
        (0, vitest_1.expect)(result.text).toBe('Thinking...');
        (0, vitest_1.expect)(result.toolCalls).toHaveLength(1);
        (0, vitest_1.expect)(result.toolCalls[0]).toEqual({
            name: 'get_weather',
            arguments: { location: 'London' },
            id: 'call_1',
        });
    });
    (0, vitest_1.it)('stream yields text deltas', async () => {
        const asyncIterator = (async function* () {
            yield { type: 'message_start', message: { usage: { input_tokens: 10, output_tokens: 0 } } };
            yield { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } };
            yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } };
            yield {
                type: 'content_block_delta',
                index: 0,
                delta: { type: 'text_delta', text: ' World' },
            };
            yield { type: 'message_delta', usage: { output_tokens: 5 } };
        })();
        mockCreate.mockResolvedValue(asyncIterator);
        const stream = adapter.stream({
            messages: [{ role: 'user', content: 'Hi' }],
        }, mockContext);
        const events = [];
        for await (const event of stream) {
            events.push(event);
        }
        const textEvents = events.filter((e) => e.type === 'text-delta');
        (0, vitest_1.expect)(textEvents[0]).toEqual({ type: 'text-delta', content: 'Hello' });
        (0, vitest_1.expect)(textEvents[1]).toEqual({ type: 'text-delta', content: ' World' });
    });
    (0, vitest_1.it)('maps RateLimitError', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const APIError = sdk_1.default.APIError;
        const error = new APIError(429, 'Rate limit');
        mockCreate.mockRejectedValue(error);
        await (0, vitest_1.expect)(adapter.generate({ messages: [{ role: 'user', content: 'hi' }] }, mockContext)).rejects.toThrow(errors_1.RateLimitError);
    });
    (0, vitest_1.it)('maps TimeoutError', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const APIConnectionTimeoutError = sdk_1.default.APIConnectionTimeoutError;
        const error = new APIConnectionTimeoutError('Timeout');
        mockCreate.mockRejectedValue(error);
        await (0, vitest_1.expect)(adapter.generate({ messages: [{ role: 'user', content: 'hi' }] }, mockContext)).rejects.toThrow(errors_1.TimeoutError);
    });
    (0, vitest_1.it)('throws ConfigError if API key is missing', () => {
        (0, vitest_1.expect)(() => new adapter_1.AnthropicAdapter({
            type: 'anthropic',
            model: 'claude-3-opus',
            // no api_key or api_key_env
        })).toThrow(errors_1.ConfigError);
    });
});
//# sourceMappingURL=adapter.test.js.map