import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAIAdapter } from './adapter';
import { StreamEvent } from '@orchestrator/shared';
import { APIError, APIConnectionTimeoutError } from 'openai';
import { RateLimitError, TimeoutError, ConfigError } from '../errors';

const mockCreate = vi.fn();

vi.mock('openai', () => {
  return {
    default: class MockOpenAI {
      chat = {
        completions: {
          create: mockCreate
        }
      };
      constructor(args: any) {}
    },
    APIError: class extends Error {
        status: number;
        constructor(message: string, status?: number) {
            super(message);
            this.status = status || 500;
        }
    },
    APIConnectionTimeoutError: class extends Error {}
  };
});

describe('OpenAIAdapter', () => {
  let adapter: OpenAIAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    
    adapter = new OpenAIAdapter({
      type: 'openai',
      model: 'gpt-4',
      api_key: 'test-key'
    });
  });

  it('generate returns text and usage', async () => {
    mockCreate.mockResolvedValue({
      choices: [{
        message: { content: 'Hello', tool_calls: null }
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
    });

    const result = await adapter.generate({
      messages: [{ role: 'user', content: 'Hi' }]
    }, {} as any);

    expect(result.text).toBe('Hello');
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hi' }],
      temperature: 0.2
    }), expect.anything());
  });

  it('generate handles tool calls', async () => {
    mockCreate.mockResolvedValue({
      choices: [{
        message: { 
          content: null,
          tool_calls: [{
            type: 'function',
            id: 'call_1',
            function: {
              name: 'get_weather',
              arguments: '{"location": "London"}'
            }
          }]
        }
      }]
    });

    const result = await adapter.generate({
      messages: [{ role: 'user', content: 'Weather?' }],
      tools: [{ name: 'get_weather', inputSchema: {} }]
    }, {} as any);

    expect(result.text).toBeUndefined();
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0]).toEqual({
      name: 'get_weather',
      arguments: { location: 'London' },
      id: 'call_1'
    });
  });

  it('stream yields text deltas', async () => {
    const asyncIterator = (async function* () {
      yield { choices: [{ delta: { content: 'Hello' } }] };
      yield { choices: [{ delta: { content: ' World' } }] };
    })();
    
    mockCreate.mockResolvedValue(asyncIterator);

    const stream = adapter.stream({
        messages: [{ role: 'user', content: 'Hi' }]
    }, {} as any);

    const events: StreamEvent[] = [];
    for await (const event of stream) {
        events.push(event);
    }

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ type: 'text-delta', content: 'Hello' });
    expect(events[1]).toEqual({ type: 'text-delta', content: ' World' });
  });

  it('maps RateLimitError', async () => {
    const error = new (APIError as any)('Rate limit', 429);
    (error as any).status = 429;
    
    mockCreate.mockRejectedValue(error);
    await expect(adapter.generate({ messages: [{role: 'user', content:'hi'}] }, {} as any))
        .rejects.toThrow(RateLimitError);
  });

  it('maps TimeoutError', async () => {
      const error = new (APIConnectionTimeoutError as any)('Timeout');
      mockCreate.mockRejectedValue(error);
      await expect(adapter.generate({ messages: [{role: 'user', content:'hi'}] }, {} as any))
          .rejects.toThrow(TimeoutError);
  });
});