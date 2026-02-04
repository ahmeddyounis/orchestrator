import type { Chunk } from '../store/types';
import type { SemanticHit } from './types';

/**
 * Computes cosine similarity between two vectors.
 * Returns value between -1 and 1, where 1 means identical direction.
 */
export function cosineSimilarity(vecA: Float32Array, vecB: Float32Array): number {
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

/**
 * Converts cosine similarity to angular distance.
 * Distance is 0 for identical vectors, 1 for orthogonal, 2 for opposite.
 */
function cosineToDistance(similarity: number): number {
  return 1 - similarity;
}

interface BallTreeNode {
  center: Float32Array;
  radius: number;
  indices: number[];
  left: BallTreeNode | null;
  right: BallTreeNode | null;
}

/**
 * A bounded max-heap that keeps track of the k-best candidates.
 * Uses distance (lower is better) for comparisons.
 */
class BoundedMaxHeap {
  private items: { index: number; distance: number }[] = [];
  readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
  }

  get size(): number {
    return this.items.length;
  }

  get worstDistance(): number {
    return this.items.length > 0 ? this.items[0].distance : Infinity;
  }

  push(index: number, distance: number): void {
    if (this.items.length < this.capacity) {
      this.items.push({ index, distance });
      this.bubbleUp(this.items.length - 1);
    } else if (distance < this.items[0].distance) {
      this.items[0] = { index, distance };
      this.bubbleDown(0);
    }
  }

  getResults(): { index: number; distance: number }[] {
    // Return sorted by distance (ascending)
    return [...this.items].sort((a, b) => a.distance - b.distance);
  }

  private bubbleUp(i: number): void {
    while (i > 0) {
      const parent = Math.floor((i - 1) / 2);
      if (this.items[parent].distance >= this.items[i].distance) break;
      [this.items[parent], this.items[i]] = [this.items[i], this.items[parent]];
      i = parent;
    }
  }

  private bubbleDown(i: number): void {
    while (true) {
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      let largest = i;

      if (left < this.items.length && this.items[left].distance > this.items[largest].distance) {
        largest = left;
      }
      if (right < this.items.length && this.items[right].distance > this.items[largest].distance) {
        largest = right;
      }

      if (largest === i) break;
      [this.items[i], this.items[largest]] = [this.items[largest], this.items[i]];
      i = largest;
    }
  }
}

/**
 * A Ball Tree implementation for efficient nearest neighbor search in high-dimensional spaces.
 * Uses cosine distance (1 - cosine_similarity) as the distance metric.
 *
 * Ball Trees partition space by enclosing points in hyperspheres, allowing for
 * efficient pruning during search - if a query point is farther from a node's
 * center than its radius plus the current k-th best distance, that entire
 * subtree can be skipped.
 *
 * Time complexity:
 * - Build: O(n log n)
 * - Search: O(log n) average case, O(n) worst case for highly clustered data
 */
export class VectorIndex {
  private root: BallTreeNode | null = null;
  private vectors: Float32Array[] = [];
  private chunks: (Chunk & { vector: Float32Array })[] = [];
  private readonly leafSize: number;

  constructor(leafSize: number = 40) {
    this.leafSize = leafSize;
  }

  /**
   * Builds the Ball Tree index from the given chunks.
   */
  build(chunks: (Chunk & { vector: Float32Array })[]): void {
    this.chunks = chunks;
    this.vectors = chunks.map((c) => c.vector);

    if (chunks.length === 0) {
      this.root = null;
      return;
    }

    const indices = Array.from({ length: chunks.length }, (_, i) => i);
    this.root = this.buildNode(indices);
  }

  private buildNode(indices: number[]): BallTreeNode {
    if (indices.length === 0) {
      throw new Error('Cannot build node with no indices');
    }

    const center = this.computeCentroid(indices);
    const radius = this.computeRadius(indices, center);

    // If we've reached leaf size, don't split further
    if (indices.length <= this.leafSize) {
      return { center, radius, indices, left: null, right: null };
    }

    // Find the point farthest from center to use as pivot for splitting
    const splitResult = this.splitIndices(indices, center);

    // If we couldn't split (all points are identical), make this a leaf
    if (!splitResult) {
      return { center, radius, indices, left: null, right: null };
    }

    const { leftIndices, rightIndices } = splitResult;

    return {
      center,
      radius,
      indices: [], // Non-leaf nodes don't store indices directly
      left: this.buildNode(leftIndices),
      right: this.buildNode(rightIndices),
    };
  }

  private computeCentroid(indices: number[]): Float32Array {
    const dim = this.vectors[0].length;
    const center = new Float32Array(dim);

    for (const idx of indices) {
      const vec = this.vectors[idx];
      for (let d = 0; d < dim; d++) {
        center[d] += vec[d];
      }
    }

    for (let d = 0; d < dim; d++) {
      center[d] /= indices.length;
    }

    return center;
  }

  private computeRadius(indices: number[], center: Float32Array): number {
    let maxDist = 0;
    for (const idx of indices) {
      const dist = cosineToDistance(cosineSimilarity(center, this.vectors[idx]));
      if (dist > maxDist) {
        maxDist = dist;
      }
    }
    return maxDist;
  }

  private splitIndices(
    indices: number[],
    center: Float32Array,
  ): { leftIndices: number[]; rightIndices: number[] } | null {
    // Find the farthest point from center
    let farthestIdx = indices[0];
    let maxDist = 0;

    for (const idx of indices) {
      const dist = cosineToDistance(cosineSimilarity(center, this.vectors[idx]));
      if (dist > maxDist) {
        maxDist = dist;
        farthestIdx = idx;
      }
    }

    // Find the point farthest from the farthest point
    const pivot1 = this.vectors[farthestIdx];
    let secondFarthestIdx = indices[0];
    maxDist = 0;

    for (const idx of indices) {
      const dist = cosineToDistance(cosineSimilarity(pivot1, this.vectors[idx]));
      if (dist > maxDist) {
        maxDist = dist;
        secondFarthestIdx = idx;
      }
    }

    // If both pivots are the same (all points identical), can't split
    if (farthestIdx === secondFarthestIdx) {
      return null;
    }

    const pivot2 = this.vectors[secondFarthestIdx];

    // Assign each point to the closer pivot
    const leftIndices: number[] = [];
    const rightIndices: number[] = [];

    for (const idx of indices) {
      const vec = this.vectors[idx];
      const dist1 = cosineToDistance(cosineSimilarity(pivot1, vec));
      const dist2 = cosineToDistance(cosineSimilarity(pivot2, vec));

      if (dist1 <= dist2) {
        leftIndices.push(idx);
      } else {
        rightIndices.push(idx);
      }
    }

    // Ensure both sides have at least one point
    if (leftIndices.length === 0 || rightIndices.length === 0) {
      return null;
    }

    return { leftIndices, rightIndices };
  }

  /**
   * Searches for the top-K most similar vectors using the Ball Tree.
   */
  search(queryVector: Float32Array, topK: number): SemanticHit[] {
    if (!this.root || this.chunks.length === 0) {
      return [];
    }

    const heap = new BoundedMaxHeap(topK);
    this.searchNode(this.root, queryVector, heap);

    const results = heap.getResults();
    return results.map(({ index, distance }) => {
      const { vector, ...rest } = this.chunks[index];
      return {
        ...rest,
        score: 1 - distance, // Convert distance back to similarity
      };
    });
  }

  private searchNode(node: BallTreeNode, query: Float32Array, heap: BoundedMaxHeap): void {
    const distToCenter = cosineToDistance(cosineSimilarity(query, node.center));

    // Prune: if the closest possible point in this ball is farther than our
    // current k-th best, we can skip this entire subtree
    const minPossibleDist = Math.max(0, distToCenter - node.radius);
    if (heap.size === heap.capacity && minPossibleDist > heap.worstDistance) {
      return;
    }

    // If this is a leaf node, check all points
    if (node.left === null && node.right === null) {
      for (const idx of node.indices) {
        const dist = cosineToDistance(cosineSimilarity(query, this.vectors[idx]));
        heap.push(idx, dist);
      }
      return;
    }

    // Recurse into children, visiting the closer one first for better pruning
    if (node.left && node.right) {
      const leftDist = cosineToDistance(cosineSimilarity(query, node.left.center));
      const rightDist = cosineToDistance(cosineSimilarity(query, node.right.center));

      if (leftDist <= rightDist) {
        this.searchNode(node.left, query, heap);
        this.searchNode(node.right, query, heap);
      } else {
        this.searchNode(node.right, query, heap);
        this.searchNode(node.left, query, heap);
      }
    } else if (node.left) {
      this.searchNode(node.left, query, heap);
    } else if (node.right) {
      this.searchNode(node.right, query, heap);
    }
  }

  /**
   * Linear search fallback - computes similarity against all vectors.
   * Used for small datasets or when index is not available.
   */
  static linearSearch(
    chunks: (Chunk & { vector: Float32Array })[],
    queryVector: Float32Array,
    topK: number,
  ): SemanticHit[] {
    const scored = chunks.map((chunk) => ({
      ...chunk,
      score: cosineSimilarity(queryVector, chunk.vector),
    }));

    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, topK).map(({ vector, ...rest }) => rest);
  }
}
