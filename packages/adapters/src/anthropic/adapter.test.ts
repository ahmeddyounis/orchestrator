import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnthropicAdapter } from './adapter';
import { StreamEvent, ProviderConfig } from '@orchestrator/shared';
import Anthropic from '@anthropic-ai/sdk';
import { RateLimitError, TimeoutError, ConfigError } from '../errors';
import { AdapterContext } from '../types';

const mockCreate = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  const MockAnthropic = class {
    messages = {
      create: mockCreate,
    };
  };

  // Attach static error classes to the mock class
  (MockAnthropic as any).APIError = class extends Error {
    status: number;
    constructor(status?: number, message?: string) {
      super(message || 'API Error');
      this.status = status || 500;
    }
  };
  (MockAnthropic as any).APIConnectionTimeoutError = class extends Error {};

  return {
    default: MockAnthropic,
  };
});

describe('AnthropicAdapter', () => {
  let adapter: AnthropicAdapter;
  const mockContext: AdapterContext = {
    runId: 'test-run',
    logger: { log: vi.fn().mockResolvedValue(undefined) },
    retryOptions: { maxRetries: 0 },
  };

  beforeEach(() => {
    vi.clearAllMocks();

    adapter = new AnthropicAdapter({
      type: 'anthropic',
      model: 'claude-3-5-sonnet-20240620',
      api_key: 'test-key',
    });
  });

  it('generate returns text and usage', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Hello' }],
      usage: { input_tokens: 10, output_tokens: 5 },
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
        model: 'claude-3-5-sonnet-20240620',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 1024,
      }),
      expect.anything(),
    );
  });

  it('generate handles tool calls', async () => {
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

    const result = await adapter.generate(
      {
        messages: [{ role: 'user', content: 'Weather?' }],
        tools: [{ name: 'get_weather', inputSchema: {} }],
      },
      mockContext,
    );

    expect(result.text).toBe('Thinking...');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0]).toEqual({
      name: 'get_weather',
      arguments: { location: 'London' },
      id: 'call_1',
    });
  });

  it('stream yields text deltas', async () => {
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

    const textEvents = events.filter((e) => e.type === 'text-delta');
    expect(textEvents[0]).toEqual({ type: 'text-delta', content: 'Hello' });
    expect(textEvents[1]).toEqual({ type: 'text-delta', content: ' World' });
  });

  it('maps RateLimitError', async () => {
    const APIError = (Anthropic as any).APIError;
    const error = new APIError(429, 'Rate limit');

    mockCreate.mockRejectedValue(error);
    await expect(
      adapter.generate({ messages: [{ role: 'user', content: 'hi' }] }, mockContext),
    ).rejects.toThrow(RateLimitError);
  });

  it('maps TimeoutError', async () => {
    const APIConnectionTimeoutError = (Anthropic as any).APIConnectionTimeoutError;
    const error = new APIConnectionTimeoutError('Timeout');
    mockCreate.mockRejectedValue(error);
    await expect(
      adapter.generate({ messages: [{ role: 'user', content: 'hi' }] }, mockContext),
    ).rejects.toThrow(TimeoutError);
  });

  it('throws ConfigError if API key is missing', () => {
    expect(
      () =>
        new AnthropicAdapter({
          type: 'anthropic',
          model: 'claude-3-opus',
          // no api_key or api_key_env
        } as ProviderConfig),
    ).toThrow(ConfigError);
  });
});
