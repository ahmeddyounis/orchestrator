import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AnthropicAdapter } from './adapter';
import { AdapterContext } from '../types';
import { RateLimitError } from '../errors';
import nock from 'nock';

describe('AnthropicAdapter Contract', () => {
  let adapter: AnthropicAdapter;
  const mockContext: AdapterContext = {
    runId: 'test-run',
    logger: { log: async () => {} },
    retryOptions: { maxRetries: 0 },
  };

  beforeEach(() => {
    nock.cleanAll();
    nock.disableNetConnect(); // Ensure no real requests
    adapter = new AnthropicAdapter({
      type: 'anthropic',
      model: 'claude-3-5-sonnet-20240620',
      api_key: 'sk-ant-test-key',
    });
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it('sends correct request payload', async () => {
    const scope = nock('https://api.anthropic.com')
      .post('/v1/messages', (body) => {
        return (
          body.model === 'claude-3-5-sonnet-20240620' &&
          body.messages[0].content === 'Hi' &&
          body.max_tokens === 1024
        );
      })
      .reply(200, {
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello there' }],
        usage: { input_tokens: 10, output_tokens: 5 },
      });

    const result = await adapter.generate(
      {
        messages: [{ role: 'user', content: 'Hi' }],
      },
      mockContext,
    );

    expect(result.text).toBe('Hello there');
    expect(scope.isDone()).toBe(true);
  });

  it('handles 429 Rate Limit', async () => {
    nock('https://api.anthropic.com')
      .persist()
      .post('/v1/messages')
      .reply(429, {
        type: 'error',
        error: { type: 'rate_limit_error', message: 'Rate limit exceeded' },
      });

    await expect(
      adapter.generate({ messages: [{ role: 'user', content: 'Hi' }] }, mockContext),
    ).rejects.toThrow(RateLimitError);
  });
});
