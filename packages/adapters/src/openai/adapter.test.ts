import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAIAdapter } from './adapter';
import { StreamEvent } from '@orchestrator/shared';
import { APIError, APIConnectionTimeoutError } from 'openai';
import { RateLimitError, TimeoutError, ConfigError } from '../errors';
import { AdapterContext } from '../types';

const mockCreate = vi.fn();

vi.mock('openai', () => {
  return {
    default: class MockOpenAI {
      chat = {
        completions: {
          create: mockCreate,
        },
      };
    },
    APIError: class extends Error {
      status: number;
      constructor(message: string, status?: number) {
        super(message);
        this.status = status || 500;
      }
    },
    APIConnectionTimeoutError: class extends Error {},
  };
});

describe('OpenAIAdapter', () => {
  let adapter: OpenAIAdapter;
  const mockContext: AdapterContext = {
    runId: 'test-run',
    logger: { log: vi.fn().mockResolvedValue(undefined) },
    retryOptions: { maxRetries: 0 },
  };

  beforeEach(() => {
    vi.clearAllMocks();

    adapter = new OpenAIAdapter({
      type: 'openai',
      model: 'gpt-4',
      api_key: 'test-key',
    });
  });

  it('generate returns text and usage', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: { content: 'Hello', tool_calls: null },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });

    const result = await adapter.generate(
      {
        messages: [{ role: 'user', content: 'Hi' }],
      },
      mockContext,
    );

    expect(result.text).toBe('Hello');
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
        temperature: 0.2,
      }),
      expect.anything(),
    );
  });

  it('generate handles tool calls', async () => {
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

    const result = await adapter.generate(
      {
        messages: [{ role: 'user', content: 'Weather?' }],
        tools: [{ name: 'get_weather', inputSchema: {} }],
      },
      mockContext,
    );

    expect(result.text).toBeUndefined();
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0]).toEqual({
      name: 'get_weather',
      arguments: { location: 'London' },
      id: 'call_1',
    });
  });

  it('stream yields text deltas', async () => {
    const asyncIterator = (async function* () {
      yield { choices: [{ delta: { content: 'Hello' } }] };
      yield { choices: [{ delta: { content: ' World' } }] };
    })();

    mockCreate.mockResolvedValue(asyncIterator);

    const stream = adapter.stream(
      {
        messages: [{ role: 'user', content: 'Hi' }],
      },
      mockContext,
    );

    const events: StreamEvent[] = [];
    for await (const event of stream) {
      events.push(event);
    }

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ type: 'text-delta', content: 'Hello' });
    expect(events[1]).toEqual({ type: 'text-delta', content: ' World' });
  });

  it('stream yields usage and tool call deltas and ignores chunks without delta', async () => {
    const asyncIterator = (async function* () {
      yield {
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
        choices: [{ delta: { content: 'Hi' } }],
      };
      yield { choices: [{}] };
      yield {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  id: 'tc_1',
                  index: 0,
                  function: { name: 'tool', arguments: '{"a":1}' },
                },
              ],
            },
          },
        ],
      };
    })();

    mockCreate.mockResolvedValue(asyncIterator);

    const stream = adapter.stream(
      {
        messages: [{ role: 'user', content: 'Hi' }],
      },
      mockContext,
    );

    const events: StreamEvent[] = [];
    for await (const event of stream) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: 'usage', usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 } },
      { type: 'text-delta', content: 'Hi' },
      {
        type: 'tool-call-delta',
        toolCall: { name: 'tool', arguments: '{"a":1}', id: 'tc_1', index: 0 },
      },
    ]);
  });

  it('generate maps assistant tool calls and tool messages', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: '', tool_calls: null } }],
    });

    await adapter.generate(
      {
        messages: [
          {
            role: 'assistant',
            toolCalls: [{ id: 'call_1', name: 'do', arguments: { x: 1 } }],
          } as any,
          {
            role: 'tool',
            toolCallId: 'call_1',
            content: 'result',
          },
        ],
      },
      mockContext,
    );

    const callArg = mockCreate.mock.calls[0]?.[0];
    expect(callArg.messages).toEqual([
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'do', arguments: '{"x":1}' },
          },
        ],
      },
      { role: 'tool', content: 'result', tool_call_id: 'call_1' },
    ]);
  });

  it('generate ignores non-function tool calls', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: 'x',
            tool_calls: [
              { type: 'not-a-function', id: 'x', function: { name: 'x', arguments: '{}' } },
            ],
          },
        },
      ],
    });

    const result = await adapter.generate(
      {
        messages: [{ role: 'user', content: 'Hi' }],
      },
      mockContext,
    );

    expect(result.toolCalls).toEqual([]);
  });

  it('maps RateLimitError', async () => {
    const error = new (APIError as any)('Rate limit', 429);
    (error as any).status = 429;

    mockCreate.mockRejectedValue(error);
    await expect(
      adapter.generate({ messages: [{ role: 'user', content: 'hi' }] }, mockContext),
    ).rejects.toThrow(RateLimitError);
  });

  it('maps TimeoutError', async () => {
    const error = new (APIConnectionTimeoutError as any)('Timeout');
    mockCreate.mockRejectedValue(error);
    await expect(
      adapter.generate({ messages: [{ role: 'user', content: 'hi' }] }, mockContext),
    ).rejects.toThrow(TimeoutError);
  });

  it('maps ConfigError for auth failures', async () => {
    const error = new (APIError as any)('Unauthorized', 401);
    (error as any).status = 401;

    mockCreate.mockRejectedValue(error);
    await expect(
      adapter.generate({ messages: [{ role: 'user', content: 'hi' }] }, mockContext),
    ).rejects.toThrow(ConfigError);
  });
});
