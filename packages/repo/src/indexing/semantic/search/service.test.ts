import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SemanticSearchService } from './service';
import { VectorIndex } from './vector-index';
import type { Embedder } from '@orchestrator/adapters';

describe('SemanticSearchService', () => {
  const mockEmbedder: Embedder = {
    id: () => 'mock-embedder',
    dims: () => 2,
    embedTexts: vi.fn(),
  } as any;

  const mockEventBus = {
    emit: vi.fn().mockResolvedValue(undefined),
  } as any;

  const mockStore = {
    getAllChunksWithEmbeddings: vi.fn(),
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits SemanticSearchFinished and uses linear search for small datasets', async () => {
    vi.mocked(mockEmbedder.embedTexts).mockResolvedValue([[1, 0]]);
    mockStore.getAllChunksWithEmbeddings.mockReturnValue([
      {
        chunkId: 'c1',
        path: 'a.ts',
        startLine: 1,
        endLine: 1,
        content: '',
        vector: new Float32Array([1, 0]),
      },
      {
        chunkId: 'c2',
        path: 'b.ts',
        startLine: 1,
        endLine: 1,
        content: '',
        vector: new Float32Array([0, 1]),
      },
    ]);

    const linearSpy = vi.spyOn(VectorIndex, 'linearSearch');
    const service = new SemanticSearchService({ store: mockStore, embedder: mockEmbedder, eventBus: mockEventBus });

    const hits = await service.search('query', 10, 'run-123');

    expect(linearSpy).toHaveBeenCalled();
    expect(hits).toHaveLength(2);
    expect(hits[0].chunkId).toBe('c1');

    expect(mockEmbedder.embedTexts).toHaveBeenCalledWith(['query'], { normalize: true });
    expect(mockEventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'SemanticSearchFinished',
        runId: 'run-123',
        payload: expect.objectContaining({
          query: 'query',
          topK: 10,
          hitCount: 2,
          candidateCount: 2,
        }),
      }),
    );
  });

  it('uses VectorIndex search for larger datasets', async () => {
    vi.mocked(mockEmbedder.embedTexts).mockResolvedValue([[1, 0]]);
    const candidates = Array.from({ length: 101 }, (_, i) => ({
      chunkId: `c${i}`,
      path: `f${i}.ts`,
      startLine: 1,
      endLine: 1,
      content: '',
      vector: new Float32Array([1, 0]),
    }));
    mockStore.getAllChunksWithEmbeddings.mockReturnValue(candidates);

    const buildSpy = vi.spyOn(VectorIndex.prototype, 'build');
    const searchSpy = vi.spyOn(VectorIndex.prototype, 'search');

    const service = new SemanticSearchService({ store: mockStore, embedder: mockEmbedder, eventBus: mockEventBus });
    await service.search('query', 5, 'run-456');

    expect(buildSpy).toHaveBeenCalled();
    expect(searchSpy).toHaveBeenCalled();
  });
});

