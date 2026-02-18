import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAIEmbedder } from './openai_embedder';
import { ConfigError, RateLimitError } from '../errors';
import { APIError } from 'openai';

const mockEmbeddingsCreate = vi.fn();

vi.mock('openai', () => {
  return {
    default: class MockOpenAI {
      embeddings = {
        create: mockEmbeddingsCreate,
      };
    },
    APIError: class extends Error {
      status: number;
      constructor(message: string, status?: number) {
        super(message);
        this.status = status ?? 500;
      }
    },
  };
});

describe('OpenAIEmbedder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws ConfigError when API key is missing', () => {
    expect(() => new OpenAIEmbedder({ apiKeyEnv: 'MISSING_KEY' })).toThrow(ConfigError);
  });

  it('reads API key from env and embeds texts', async () => {
    process.env.TEST_OPENAI_KEY = 'test-key';
    mockEmbeddingsCreate.mockResolvedValue({
      data: [{ embedding: [1, 2] }, { embedding: [3, 4] }],
    });

    const embedder = new OpenAIEmbedder({ apiKeyEnv: 'TEST_OPENAI_KEY', model: 'm' });
    await expect(embedder.embedTexts(['a', 'b'])).resolves.toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it('maps rate limit errors', async () => {
    mockEmbeddingsCreate.mockRejectedValue(new APIError('rate limited', 429));
    const embedder = new OpenAIEmbedder({ apiKey: 'k' });

    await expect(embedder.embedTexts(['a'])).rejects.toBeInstanceOf(RateLimitError);
  });

  it('maps auth errors to ConfigError', async () => {
    mockEmbeddingsCreate.mockRejectedValue(new APIError('unauthorized', 401));
    const embedder = new OpenAIEmbedder({ apiKey: 'k' });

    await expect(embedder.embedTexts(['a'])).rejects.toBeInstanceOf(ConfigError);
  });

  it('wraps non-Error failures', async () => {
    mockEmbeddingsCreate.mockRejectedValue('boom');
    const embedder = new OpenAIEmbedder({ apiKey: 'k' });

    await expect(embedder.embedTexts(['a'])).rejects.toThrow('boom');
  });

  it('returns configured dimensions and stable id', () => {
    const embedder = new OpenAIEmbedder({ apiKey: 'k', model: 'm', dimensions: 12 });
    expect(embedder.dims()).toBe(12);
    expect(embedder.id()).toBe('openai:m');
  });

  it('infers default dims for known models', () => {
    expect(new OpenAIEmbedder({ apiKey: 'k' }).dims()).toBe(1536);
    expect(new OpenAIEmbedder({ apiKey: 'k', model: 'text-embedding-3-large' }).dims()).toBe(3072);
    expect(new OpenAIEmbedder({ apiKey: 'k', model: 'unknown' }).dims()).toBe(0);
  });
});

