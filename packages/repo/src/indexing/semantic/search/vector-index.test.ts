import { describe, it, expect } from 'vitest';
import { cosineSimilarity, VectorIndex } from './vector-index';

describe('vector-index', () => {
  describe('cosineSimilarity', () => {
    it('returns -1 for mismatched dimensions', () => {
      expect(cosineSimilarity(new Float32Array([1, 0]), new Float32Array([1]))).toBe(-1);
    });

    it('returns 0 when either vector has zero magnitude', () => {
      expect(cosineSimilarity(new Float32Array([0, 0]), new Float32Array([1, 0]))).toBe(0);
    });

    it('computes cosine similarity for non-zero vectors', () => {
      expect(cosineSimilarity(new Float32Array([1, 0]), new Float32Array([1, 0]))).toBe(1);
      expect(cosineSimilarity(new Float32Array([1, 0]), new Float32Array([0, 1]))).toBe(0);
    });
  });

  it('builds and searches an index', () => {
    const index = new VectorIndex(1);
    index.build([
      {
        chunkId: 'c1',
        path: 'a.ts',
        startLine: 1,
        endLine: 1,
        content: 'a',
        vector: new Float32Array([1, 0]),
      } as any,
      {
        chunkId: 'c2',
        path: 'b.ts',
        startLine: 1,
        endLine: 1,
        content: 'b',
        vector: new Float32Array([0, 1]),
      } as any,
      {
        chunkId: 'c3',
        path: 'c.ts',
        startLine: 1,
        endLine: 1,
        content: 'c',
        vector: new Float32Array([1, 1]),
      } as any,
    ]);

    const hits = index.search(new Float32Array([1, 0]), 2);
    expect(hits).toHaveLength(2);
    expect(hits[0].chunkId).toBe('c1');
    expect(hits[0].score).toBeGreaterThanOrEqual(hits[1].score);
  });

  it('returns empty results when built with no chunks', () => {
    const index = new VectorIndex();
    index.build([]);
    expect(index.search(new Float32Array([1, 0]), 3)).toEqual([]);
  });

  it('falls back to a leaf when all vectors are identical', () => {
    const index = new VectorIndex(1);
    index.build([
      {
        chunkId: 'c1',
        path: 'a.ts',
        startLine: 1,
        endLine: 1,
        content: 'a',
        vector: new Float32Array([1, 0]),
      } as any,
      {
        chunkId: 'c2',
        path: 'b.ts',
        startLine: 1,
        endLine: 1,
        content: 'b',
        vector: new Float32Array([1, 0]),
      } as any,
    ]);

    const hits = index.search(new Float32Array([1, 0]), 10);
    expect(hits.length).toBeGreaterThan(0);
  });

  it('handles degenerate roots with only one child', () => {
    const index = new VectorIndex();
    const vec = new Float32Array([1, 0]);

    (index as any).vectors = [vec];
    (index as any).chunks = [
      {
        chunkId: 'c1',
        path: 'a.ts',
        startLine: 1,
        endLine: 1,
        content: 'a',
        vector: vec,
      },
    ];

    (index as any).root = {
      center: vec,
      radius: 0,
      indices: [],
      left: { center: vec, radius: 0, indices: [0], left: null, right: null },
      right: null,
    };
    expect(index.search(vec, 1)).toHaveLength(1);

    (index as any).root = {
      center: vec,
      radius: 0,
      indices: [],
      left: null,
      right: { center: vec, radius: 0, indices: [0], left: null, right: null },
    };
    expect(index.search(vec, 1)).toHaveLength(1);
  });

  it('throws when trying to build a node with no indices', () => {
    const index = new VectorIndex();
    expect(() => (index as any).buildNode([])).toThrow(/no indices/i);
  });
});
