import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { OpenAIAdapter } from './adapter';
import { AdapterContext } from '../types';
import { RateLimitError } from '../errors';
import nock from 'nock';

describe('OpenAIAdapter Contract', () => {
  let adapter: OpenAIAdapter;
  const mockContext: AdapterContext = {
    runId: 'test-run',
    logger: { log: async () => {} },
    retryOptions: { maxRetries: 0 },
  };

  beforeEach(() => {
    nock.cleanAll();
    nock.disableNetConnect();
    adapter = new OpenAIAdapter({
      type: 'openai',
      model: 'gpt-4',
      api_key: 'sk-openai-test-key',
    });
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it('sends correct request payload', async () => {
    const scope = nock('https://api.openai.com')
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
    nock('https://api.openai.com')
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

    await expect(
      adapter.generate({ messages: [{ role: 'user', content: 'Hi' }] }, mockContext),
    ).rejects.toThrow(RateLimitError);
  });
});
