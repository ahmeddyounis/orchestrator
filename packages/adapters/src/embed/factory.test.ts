import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

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

import { createEmbedder } from './factory';

describe('createEmbedder', () => {
  const originalOpenAiKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (originalOpenAiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalOpenAiKey;
    }
  });

  it('creates a cached local-hash embedder', async () => {
    const embedder = createEmbedder({
      provider: 'local-hash',
      dims: 16,
      batchSize: 1,
    });

    expect(embedder.dims()).toBe(16);
    expect(embedder.id()).toBe('cached(local-hash-dim16)');
    expect(await embedder.embedTexts(['hello'])).toHaveLength(1);
  });

  it('creates a cached OpenAI embedder', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    mockEmbeddingsCreate.mockResolvedValue({
      data: [{ embedding: [1, 2, 3] }],
    });

    const embedder = createEmbedder({
      provider: 'openai',
      model: 'text-embedding-3-small',
      dims: 1536,
      batchSize: 1,
    });

    expect(embedder.id()).toBe('cached(openai:text-embedding-3-small)');
    expect(embedder.dims()).toBe(1536);

    await expect(embedder.embedTexts(['hello'])).resolves.toEqual([[1, 2, 3]]);
  });

  it('throws for unsupported providers', () => {
    expect(() =>
      createEmbedder({
        provider: 'unsupported' as never,
        dims: 8,
        batchSize: 1,
      }),
    ).toThrow(/Unsupported embedder provider/);
  });
});
