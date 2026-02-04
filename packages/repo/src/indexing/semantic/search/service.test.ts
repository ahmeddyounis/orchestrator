import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SemanticSearchService } from './service';
import type { SemanticIndexStore } from '../store';
import type { Embedder } from '@orchestrator/adapters';
import type { EventBus } from '@orchestrator/shared';
import type { Chunk } from '../store/types';

// Re-implement cosineSimilarity for testing expected values
function cosineSimilarity(vecA: Float32Array, vecB: Float32Array): number {
  if (vecA.length !== vecB.length) {
    return -1;
  }

  let dotProduct = 0.0;
  let normA = 0.0;
  let normB = 0.0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

describe('cosineSimilarity', () => {
  describe('basic cases', () => {
    it('returns 1 for identical normalized vectors', () => {
      const vec = new Float32Array([0.6, 0.8]); // normalized: 0.6^2 + 0.8^2 = 1
      const result = cosineSimilarity(vec, vec);
      expect(result).toBeCloseTo(1.0, 6);
    });

    it('returns 1 for identical non-normalized vectors', () => {
      const vec = new Float32Array([3, 4]);
      const result = cosineSimilarity(vec, vec);
      expect(result).toBeCloseTo(1.0, 6);
    });

    it('returns -1 for vectors with different lengths', () => {
      const vecA = new Float32Array([1, 2, 3]);
      const vecB = new Float32Array([1, 2]);
      expect(cosineSimilarity(vecA, vecB)).toBe(-1);
    });

    it('returns 0 for zero vector in first argument', () => {
      const zero = new Float32Array([0, 0, 0]);
      const other = new Float32Array([1, 2, 3]);
      expect(cosineSimilarity(zero, other)).toBe(0);
    });

    it('returns 0 for zero vector in second argument', () => {
      const other = new Float32Array([1, 2, 3]);
      const zero = new Float32Array([0, 0, 0]);
      expect(cosineSimilarity(other, zero)).toBe(0);
    });

    it('returns 0 for both zero vectors', () => {
      const zero = new Float32Array([0, 0, 0]);
      expect(cosineSimilarity(zero, zero)).toBe(0);
    });
  });

  describe('orthogonal vectors', () => {
    it('returns 0 for orthogonal unit vectors', () => {
      const vecA = new Float32Array([1, 0]);
      const vecB = new Float32Array([0, 1]);
      expect(cosineSimilarity(vecA, vecB)).toBeCloseTo(0, 6);
    });

    it('returns 0 for orthogonal non-unit vectors', () => {
      const vecA = new Float32Array([3, 0]);
      const vecB = new Float32Array([0, 5]);
      expect(cosineSimilarity(vecA, vecB)).toBeCloseTo(0, 6);
    });

    it('returns 0 for orthogonal 3D vectors', () => {
      const vecA = new Float32Array([1, 0, 0]);
      const vecB = new Float32Array([0, 1, 0]);
      expect(cosineSimilarity(vecA, vecB)).toBeCloseTo(0, 6);
    });
  });

  describe('opposite vectors', () => {
    it('returns -1 for opposite unit vectors', () => {
      const vecA = new Float32Array([1, 0]);
      const vecB = new Float32Array([-1, 0]);
      expect(cosineSimilarity(vecA, vecB)).toBeCloseTo(-1.0, 6);
    });

    it('returns -1 for opposite non-unit vectors', () => {
      const vecA = new Float32Array([3, 4]);
      const vecB = new Float32Array([-3, -4]);
      expect(cosineSimilarity(vecA, vecB)).toBeCloseTo(-1.0, 6);
    });
  });

  describe('angle calculations', () => {
    it('returns correct value for 45-degree angle', () => {
      const vecA = new Float32Array([1, 0]);
      const vecB = new Float32Array([1, 1]);
      // cos(45°) = 1/√2 ≈ 0.7071
      expect(cosineSimilarity(vecA, vecB)).toBeCloseTo(Math.cos(Math.PI / 4), 6);
    });

    it('returns correct value for 60-degree angle', () => {
      const vecA = new Float32Array([1, 0]);
      const vecB = new Float32Array([0.5, Math.sqrt(3) / 2]);
      // cos(60°) = 0.5
      expect(cosineSimilarity(vecA, vecB)).toBeCloseTo(0.5, 6);
    });

    it('handles high-dimensional vectors', () => {
      // Create two random high-dimensional vectors
      const dim = 1536; // Common embedding dimension
      const vecA = new Float32Array(dim);
      const vecB = new Float32Array(dim);

      for (let i = 0; i < dim; i++) {
        vecA[i] = Math.random() - 0.5;
        vecB[i] = Math.random() - 0.5;
      }

      const result = cosineSimilarity(vecA, vecB);
      // Result should be between -1 and 1
      expect(result).toBeGreaterThanOrEqual(-1);
      expect(result).toBeLessThanOrEqual(1);
    });
  });

  describe('numerical precision', () => {
    it('handles very small values', () => {
      const vecA = new Float32Array([1e-20, 1e-20]);
      const vecB = new Float32Array([1e-20, 1e-20]);
      expect(cosineSimilarity(vecA, vecB)).toBeCloseTo(1.0, 5);
    });

    it('handles mixed positive and negative values', () => {
      const vecA = new Float32Array([1, -1, 2, -2]);
      const vecB = new Float32Array([1, -1, 2, -2]);
      expect(cosineSimilarity(vecA, vecB)).toBeCloseTo(1.0, 6);
    });
  });
});

describe('SemanticSearchService', () => {
  let mockStore: SemanticIndexStore;
  let mockEmbedder: Embedder;
  let mockEventBus: EventBus;
  let service: SemanticSearchService;

  const createChunk = (
    chunkId: string,
    name: string,
    vector: Float32Array,
  ): Chunk & { vector: Float32Array } => ({
    chunkId,
    path: `src/${name}.ts`,
    language: 'typescript',
    kind: 'function',
    name,
    parentName: null,
    startLine: 1,
    endLine: 10,
    content: `function ${name}() {}`,
    fileHash: 'abc123',
    vector,
  });

  beforeEach(() => {
    mockStore = {
      getAllChunksWithEmbeddings: vi.fn(),
    } as unknown as SemanticIndexStore;

    mockEmbedder = {
      embedTexts: vi.fn(),
    } as unknown as Embedder;

    mockEventBus = {
      emit: vi.fn().mockResolvedValue(undefined),
    } as unknown as EventBus;

    service = new SemanticSearchService({
      store: mockStore,
      embedder: mockEmbedder,
      eventBus: mockEventBus,
    });
  });

  describe('search', () => {
    it('returns empty array when no embeddings from embedder', async () => {
      vi.mocked(mockEmbedder.embedTexts).mockResolvedValue([]);

      const result = await service.search('test query', 5, 'run-123');

      expect(result).toEqual([]);
      expect(mockStore.getAllChunksWithEmbeddings).not.toHaveBeenCalled();
    });

    it('returns empty array when no candidates in store', async () => {
      vi.mocked(mockEmbedder.embedTexts).mockResolvedValue([[1, 0, 0]]);
      vi.mocked(mockStore.getAllChunksWithEmbeddings).mockReturnValue([]);

      const result = await service.search('test query', 5, 'run-123');

      expect(result).toEqual([]);
      expect(mockEventBus.emit).toHaveBeenCalled();
    });

    it('ranks candidates by cosine similarity', async () => {
      const queryVector = [1, 0, 0];
      vi.mocked(mockEmbedder.embedTexts).mockResolvedValue([queryVector]);

      // Create candidates with known similarity scores
      const exactMatch = createChunk('c1', 'exact', new Float32Array([1, 0, 0])); // score = 1.0
      const partial = createChunk('c2', 'partial', new Float32Array([0.7071, 0.7071, 0])); // score ≈ 0.7071
      const orthogonal = createChunk('c3', 'orthogonal', new Float32Array([0, 1, 0])); // score = 0

      vi.mocked(mockStore.getAllChunksWithEmbeddings).mockReturnValue([
        partial,
        orthogonal,
        exactMatch,
      ]);

      const result = await service.search('test query', 3, 'run-123');

      expect(result).toHaveLength(3);
      expect(result[0].name).toBe('exact');
      expect(result[0].score).toBeCloseTo(1.0, 5);
      expect(result[1].name).toBe('partial');
      expect(result[1].score).toBeCloseTo(0.7071, 4);
      expect(result[2].name).toBe('orthogonal');
      expect(result[2].score).toBeCloseTo(0, 5);
    });

    it('limits results to topK', async () => {
      vi.mocked(mockEmbedder.embedTexts).mockResolvedValue([[1, 0, 0]]);

      const chunks = [
        createChunk('c1', 'a', new Float32Array([1, 0, 0])),
        createChunk('c2', 'b', new Float32Array([0.9, 0.1, 0])),
        createChunk('c3', 'c', new Float32Array([0.8, 0.2, 0])),
        createChunk('c4', 'd', new Float32Array([0.7, 0.3, 0])),
        createChunk('c5', 'e', new Float32Array([0.6, 0.4, 0])),
      ];

      vi.mocked(mockStore.getAllChunksWithEmbeddings).mockReturnValue(chunks);

      const result = await service.search('test query', 2, 'run-123');

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('a');
      expect(result[1].name).toBe('b');
    });

    it('does not include vector in returned hits', async () => {
      vi.mocked(mockEmbedder.embedTexts).mockResolvedValue([[1, 0, 0]]);

      const chunk = createChunk('c1', 'test', new Float32Array([1, 0, 0]));
      vi.mocked(mockStore.getAllChunksWithEmbeddings).mockReturnValue([chunk]);

      const result = await service.search('test query', 1, 'run-123');

      expect(result).toHaveLength(1);
      expect('vector' in result[0]).toBe(false);
      expect(result[0].score).toBeCloseTo(1.0, 5);
    });

    it('emits SemanticSearchFinished event with correct payload', async () => {
      vi.mocked(mockEmbedder.embedTexts).mockResolvedValue([[1, 0, 0]]);

      const chunks = [
        createChunk('c1', 'a', new Float32Array([1, 0, 0])),
        createChunk('c2', 'b', new Float32Array([0, 1, 0])),
      ];
      vi.mocked(mockStore.getAllChunksWithEmbeddings).mockReturnValue(chunks);

      await service.search('find functions', 10, 'run-456');

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'SemanticSearchFinished',
          schemaVersion: 1,
          runId: 'run-456',
          payload: expect.objectContaining({
            query: 'find functions',
            topK: 10,
            hitCount: 2,
            candidateCount: 2,
          }),
        }),
      );
    });

    it('passes normalize option to embedder', async () => {
      vi.mocked(mockEmbedder.embedTexts).mockResolvedValue([]);

      await service.search('test', 5, 'run-123');
