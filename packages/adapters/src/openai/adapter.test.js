"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const adapter_1 = require("./adapter");
const openai_1 = require("openai");
const errors_1 = require("../errors");
const mockCreate = vitest_1.vi.fn();
vitest_1.vi.mock('openai', () => {
    return {
        default: class MockOpenAI {
            chat = {
                completions: {
                    create: mockCreate,
                },
            };
        },
        APIError: class extends Error {
            status;
            constructor(message, status) {
                super(message);
                this.status = status || 500;
            }
        },
        APIConnectionTimeoutError: class extends Error {
        },
    };
});
(0, vitest_1.describe)('OpenAIAdapter', () => {
    let adapter;
    const mockContext = {
        runId: 'test-run',
        logger: { log: vitest_1.vi.fn().mockResolvedValue(undefined) },
        retryOptions: { maxRetries: 0 },
    };
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
        adapter = new adapter_1.OpenAIAdapter({
            type: 'openai',
            model: 'gpt-4',
            api_key: 'test-key',
        });
    });
    (0, vitest_1.it)('generate returns text and usage', async () => {
        mockCreate.mockResolvedValue({
            choices: [
                {
                    message: { content: 'Hello', tool_calls: null },
                },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        });
        const result = await adapter.generate({
            messages: [{ role: 'user', content: 'Hi' }],
        }, mockContext);
        (0, vitest_1.expect)(result.text).toBe('Hello');
        (0, vitest_1.expect)(result.usage).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
        (0, vitest_1.expect)(mockCreate).toHaveBeenCalledWith(vitest_1.expect.objectContaining({
            model: 'gpt-4',
            messages: [{ role: 'user', content: 'Hi' }],
            temperature: 0.2,
        }), vitest_1.expect.anything());
    });
    (0, vitest_1.it)('generate handles tool calls', async () => {
        mockCreate.mockResolvedValue({
            choices: [
                {
                    message: {
                        content: null,
                        tool_calls: [
                            {
                                type: 'function',
                                id: 'call_1',
                                function: {
                                    name: 'get_weather',
                                    arguments: '{"location": "London"}',
                                },
                            },
                        ],
                    },
                },
            ],
        });
        const result = await adapter.generate({
            messages: [{ role: 'user', content: 'Weather?' }],
            tools: [{ name: 'get_weather', inputSchema: {} }],
        }, mockContext);
        (0, vitest_1.expect)(result.text).toBeUndefined();
        (0, vitest_1.expect)(result.toolCalls).toHaveLength(1);
        (0, vitest_1.expect)(result.toolCalls[0]).toEqual({
            name: 'get_weather',
            arguments: { location: 'London' },
            id: 'call_1',
        });
    });
    (0, vitest_1.it)('stream yields text deltas', async () => {
        const asyncIterator = (async function* () {
            yield { choices: [{ delta: { content: 'Hello' } }] };
            yield { choices: [{ delta: { content: ' World' } }] };
        })();
        mockCreate.mockResolvedValue(asyncIterator);
        const stream = adapter.stream({
            messages: [{ role: 'user', content: 'Hi' }],
        }, mockContext);
        const events = [];
        for await (const event of stream) {
            events.push(event);
        }
        (0, vitest_1.expect)(events).toHaveLength(2);
        (0, vitest_1.expect)(events[0]).toEqual({ type: 'text-delta', content: 'Hello' });
        (0, vitest_1.expect)(events[1]).toEqual({ type: 'text-delta', content: ' World' });
    });
    (0, vitest_1.it)('maps RateLimitError', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const error = new openai_1.APIError('Rate limit', 429);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        error.status = 429;
        mockCreate.mockRejectedValue(error);
        await (0, vitest_1.expect)(adapter.generate({ messages: [{ role: 'user', content: 'hi' }] }, mockContext)).rejects.toThrow(errors_1.RateLimitError);
    });
    (0, vitest_1.it)('maps TimeoutError', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const error = new openai_1.APIConnectionTimeoutError('Timeout');
        mockCreate.mockRejectedValue(error);
        await (0, vitest_1.expect)(adapter.generate({ messages: [{ role: 'user', content: 'hi' }] }, mockContext)).rejects.toThrow(errors_1.TimeoutError);
    });
});
