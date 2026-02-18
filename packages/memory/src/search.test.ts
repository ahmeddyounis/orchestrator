import { MemorySearchService, MemorySearchServiceDependencies } from './search';
import { MemoryStore } from './sqlite';
import { VectorMemoryBackend, VectorQueryResult } from './vector';
import { Embedder } from '@orchestrator/adapters';
import { MemorySearchRequest, LexicalHit, VectorHit } from './types';
import { vi, describe, it, expect, beforeEach } from 'vitest';

const createMockMemoryStore = (): MemoryStore => ({
  init: vi.fn(),
  upsert: vi.fn(),
  search: vi.fn(),
  get: vi.fn(),
  list: vi.fn(),
  listEntriesForRepo: vi.fn(),
  listEntriesWithoutVectors: vi.fn(),
  markVectorUpdated: vi.fn(),
  updateStaleFlag: vi.fn(),
  wipe: vi.fn(),
  status: vi.fn(),
  close: vi.fn(),
});

const createMockVectorBackend = (): VectorMemoryBackend => ({
  init: vi.fn(),
  upsert: vi.fn(),
  query: vi.fn(),
  deleteByIds: vi.fn(),
  wipeRepo: vi.fn(),
  info: vi.fn(),
  close: vi.fn(),
});

const createMockEmbedder = (): Embedder => ({
  embedTexts: vi.fn(),
  dims: vi.fn(() => 4),
  id: vi.fn(() => 'mock-embedder'),
});

describe('MemorySearchService', () => {
  let deps: MemorySearchServiceDependencies;
  let searchService: MemorySearchService;
  let mockMemoryStore: MemoryStore;
  let mockVectorBackend: VectorMemoryBackend;
  let mockEmbedder: Embedder;

  beforeEach(() => {
    mockMemoryStore = createMockMemoryStore();
    mockVectorBackend = createMockVectorBackend();
    mockEmbedder = createMockEmbedder();

    deps = {
      memoryStore: mockMemoryStore,
      vectorBackend: mockVectorBackend,
      embedder: mockEmbedder,
      repoId: 'test-repo',
    };
    searchService = new MemorySearchService(deps);
  });

  it('should perform lexical search', async () => {
    const request: MemorySearchRequest = {
      query: 'test',
      mode: 'lexical',
      topKFinal: 5,
    };

    const lexicalHits: LexicalHit[] = [
      {
        id: '1',
        title: 'test 1',
        content: 'content 1',
        lexicalScore: 0.9,
        type: 'procedural',
        stale: false,
        createdAt: 0,
        updatedAt: 0,
      },
      {
        id: '2',
        title: 'test 2',
        content: 'content 2',
        lexicalScore: 0.8,
        type: 'episodic',
        stale: false,
        createdAt: 0,
        updatedAt: 0,
      },
    ];

    vi.spyOn(mockMemoryStore, 'search').mockReturnValue(lexicalHits);

    const result = await searchService.search(request);

    expect(mockMemoryStore.search).toHaveBeenCalledWith('test-repo', 'test', { topK: 5 });
    expect(result.methodUsed).toBe('lexical');
    expect(result.hits).toEqual(lexicalHits);
    expect(result.events).toEqual([]);
  });

  it('should perform vector search', async () => {
    const request: MemorySearchRequest = {
      query: 'test',
      mode: 'vector',
      topKFinal: 5,
    };

    const queryVector = [[1, 2, 3, 4]];
    vi.spyOn(mockEmbedder, 'embedTexts').mockResolvedValue(queryVector);

    const vectorQueryResults: VectorQueryResult[] = [
      { id: '1', score: 0.95 },
      { id: '3', score: 0.85 },
    ];
    vi.spyOn(mockVectorBackend, 'query').mockResolvedValue(vectorQueryResults);

    const memoryEntries: Array<{
      id: string;
      title: string;
      content: string;
      type: 'procedural' | 'episodic' | 'semantic';
      stale: boolean;
      createdAt: number;
      updatedAt: number;
      repoId: string;
    }> = [
      {
        id: '1',
        title: 'test 1',
        content: 'content 1',
        type: 'procedural',
        stale: false,
        createdAt: 0,
        updatedAt: 0,
        repoId: 'test-repo',
      },
      {
        id: '3',
        title: 'test 3',
        content: 'content 3',
        type: 'semantic',
        stale: true,
        createdAt: 0,
        updatedAt: 0,
        repoId: 'test-repo',
      },
    ];
    vi.spyOn(mockMemoryStore, 'get').mockImplementation(
      (id: string) => memoryEntries.find((e) => e.id === id) || null,
    );

    const result = await searchService.search(request);

    expect(mockEmbedder.embedTexts).toHaveBeenCalledWith(['test']);
    expect(mockVectorBackend.query).toHaveBeenCalledWith(
      {},
      'test-repo',
      new Float32Array([1, 2, 3, 4]),
      10,
    );
    expect(result.methodUsed).toBe('vector');
    expect(result.hits.length).toBe(2);
    expect(result.hits[0].id).toBe('1');
    expect((result.hits[0] as VectorHit).vectorScore).toBe(0.95);
    expect(result.hits[1].id).toBe('3');
    expect((result.hits[1] as VectorHit).vectorScore).toBe(0.85);
  });

  it('skips missing and blocked entries when hydrating vector hits', async () => {
    const request: MemorySearchRequest = {
      query: 'test',
      mode: 'vector',
      topKFinal: 10,
      topKVector: 10,
    };

    vi.spyOn(mockEmbedder, 'embedTexts').mockResolvedValue([[1, 2, 3, 4]]);
    vi.spyOn(mockVectorBackend, 'query').mockResolvedValue([
      { id: 'blocked', score: 0.9 },
      { id: 'missing', score: 0.8 },
      { id: 'ok', score: 0.7 },
    ]);

    const entries = [
      {
        id: 'blocked',
        repoId: 'test-repo',
        title: 'blocked',
        content: 'c',
        type: 'procedural' as const,
        stale: false,
        integrityStatus: 'blocked' as const,
        createdAt: 0,
        updatedAt: 0,
      },
      {
        id: 'ok',
        repoId: 'test-repo',
        title: 'ok',
        content: 'c',
        type: 'semantic' as const,
        stale: false,
        integrityStatus: 'ok' as const,
        createdAt: 0,
        updatedAt: 0,
      },
    ];
    vi.spyOn(mockMemoryStore, 'get').mockImplementation(
      (id: string) => entries.find((e) => e.id === id) || null,
    );

    const result = await searchService.search(request);

    expect(result.methodUsed).toBe('vector');
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0].id).toBe('ok');
    expect((result.hits[0] as VectorHit).vectorScore).toBe(0.7);
  });

  it('should perform hybrid search', async () => {
    const request: MemorySearchRequest = {
      query: 'test',
      mode: 'hybrid',
      topKFinal: 5,
      staleDownrank: true,
      proceduralBoost: true,
    };

    const lexicalHits: LexicalHit[] = [
      {
        id: '1',
        title: 'test 1',
        content: 'content 1',
        lexicalScore: 0.9,
        type: 'procedural',
        stale: false,
        createdAt: 0,
        updatedAt: 0,
      },
      {
        id: '2',
        title: 'test 2',
        content: 'content 2',
        lexicalScore: 0.8,
        type: 'episodic',
        stale: true,
        createdAt: 0,
        updatedAt: 0,
      },
    ];
    vi.spyOn(mockMemoryStore, 'search').mockReturnValue(lexicalHits);

    const queryVector = [[1, 2, 3, 4]];
    vi.spyOn(mockEmbedder, 'embedTexts').mockResolvedValue(queryVector);

    const vectorQueryResults: VectorQueryResult[] = [
      { id: '1', score: 0.95 },
      { id: '3', score: 0.85 },
    ];
    vi.spyOn(mockVectorBackend, 'query').mockResolvedValue(vectorQueryResults);

    const memoryEntries: Array<{
      id: string;
      title: string;
      content: string;
      type: 'procedural' | 'episodic' | 'semantic';
      stale: boolean;
      createdAt: number;
      updatedAt: number;
      repoId: string;
    }> = [
      {
        id: '1',
        title: 'test 1',
        content: 'content 1',
        type: 'procedural',
        stale: false,
        createdAt: 0,
        updatedAt: 0,
        repoId: 'test-repo',
      },
      {
        id: '2',
        title: 'test 2',
        content: 'content 2',
        type: 'episodic',
        stale: true,
        createdAt: 0,
        updatedAt: 0,
        repoId: 'test-repo',
      },
      {
        id: '3',
        title: 'test 3',
        content: 'content 3',
        type: 'semantic',
        stale: false,
        createdAt: 0,
        updatedAt: 0,
        repoId: 'test-repo',
      },
    ];
    vi.spyOn(mockMemoryStore, 'get').mockImplementation(
      (id: string) => memoryEntries.find((e) => e.id === id) || null,
    );

    const result = await searchService.search(request);

    expect(result.methodUsed).toBe('hybrid');
    expect(result.hits.length).toBe(3);
    // Hit 1 is procedural, gets a boost
    // Hit 2 is stale, gets a penalty
    // Hit 3 is only in vector
    expect(result.hits[0].id).toBe('1');
    expect(result.hits[1].id).toBe('3');
    expect(result.hits[2].id).toBe('2');
  });

  it('should correctly merge unique items from lexical and vector searches in hybrid mode', async () => {
    const request: MemorySearchRequest = {
      query: 'shared',
      mode: 'hybrid',
      topKFinal: 4,
      // Disable other ranking factors to isolate the merge logic
      staleDownrank: false,
      proceduralBoost: false,
    };

    // Lexical returns L1, L2
    const lexicalHits: LexicalHit[] = [
      {
        id: 'L1',
        title: 'lexical 1',
        content: 'c',
        lexicalScore: 0.9,
        type: 'procedural',
        stale: false,
        createdAt: 0,
        updatedAt: 0,
      },
      {
        id: 'L2',
        title: 'lexical 2',
        content: 'c',
        lexicalScore: 0.8,
        type: 'episodic',
        stale: false,
        createdAt: 0,
        updatedAt: 0,
      },
    ];
    vi.spyOn(mockMemoryStore, 'search').mockReturnValue(lexicalHits);

    // Vector returns V1, L1 (overlap)
    const queryVector = [[1, 1, 1, 1]];
    vi.spyOn(mockEmbedder, 'embedTexts').mockResolvedValue(queryVector);

    const vectorQueryResults: VectorQueryResult[] = [
      { id: 'V1', score: 0.95 },
      { id: 'L1', score: 0.85 },
    ];
    vi.spyOn(mockVectorBackend, 'query').mockResolvedValue(vectorQueryResults);

    const memoryEntries = [
      {
        id: 'L1',
        title: 'lexical 1',
        content: 'c',
        type: 'procedural',
        stale: false,
        createdAt: 0,
        updatedAt: 0,
        repoId: 'test-repo',
      },
      {
        id: 'L2',
        title: 'lexical 2',
        content: 'c',
        type: 'episodic',
        stale: false,
        createdAt: 0,
        updatedAt: 0,
        repoId: 'test-repo',
      },
      {
        id: 'V1',
        title: 'vector 1',
        content: 'c',
        type: 'semantic',
        stale: false,
        createdAt: 0,
        updatedAt: 0,
        repoId: 'test-repo',
      },
    ];
    vi.spyOn(mockMemoryStore, 'get').mockImplementation(
      (id: string) => memoryEntries.find((e) => e.id === id) || null,
    );

    const result = await searchService.search(request);

    // Expected final hits: V1, L1, L2 (3 unique items)
    expect(result.methodUsed).toBe('hybrid');
    expect(result.hits.length).toBe(3);

    // V1 has the highest vector score and no lexical score -> total score based on vector score
    // L1 has high lexical and high vector score -> should be high up
    // L2 has only a lexical score
    // The reranking logic combines these. Let's check the IDs are all present.
    const hitIds = result.hits.map((h) => h.id);
    expect(hitIds).toContain('L1');
    expect(hitIds).toContain('L2');
    expect(hitIds).toContain('V1');

    // Check that L1 (which was in both) has both scores
    const l1Hit = result.hits.find((h) => h.id === 'L1');
    expect(l1Hit).toBeDefined();
    expect((l1Hit as LexicalHit).lexicalScore).toBeGreaterThan(0);
    expect((l1Hit as VectorHit).vectorScore).toBeGreaterThan(0);
  });

  it('should fallback to lexical search if vector search fails in hybrid mode', async () => {
    const request: MemorySearchRequest = {
      query: 'test',
      mode: 'hybrid',
      topKFinal: 5,
      fallbackToLexicalOnVectorError: true,
    };

    const lexicalHits: LexicalHit[] = [
      {
        id: '1',
        title: 'test 1',
        content: 'content 1',
        lexicalScore: 0.9,
        type: 'procedural',
        stale: false,
        createdAt: 0,
        updatedAt: 0,
      },
    ];
    vi.spyOn(mockMemoryStore, 'search').mockReturnValue(lexicalHits);

    vi.spyOn(mockEmbedder, 'embedTexts').mockRejectedValue(new Error('Vector DB is down'));

    const result = await searchService.search(request);

    expect(result.methodUsed).toBe('lexical');
    expect(result.hits).toEqual(lexicalHits);
    expect(result.events).toEqual(['VectorSearchFailed', 'VectorSearchFailedFallback']);
  });

  it('should throw an error if vector search fails and fallback is disabled', async () => {
    const request: MemorySearchRequest = {
      query: 'test',
      mode: 'hybrid',
      topKFinal: 5,
      fallbackToLexicalOnVectorError: false, // Explicitly disable
    };

    const lexicalHits: LexicalHit[] = [
      {
        id: '1',
        title: 't',
        content: 'c',
        lexicalScore: 0.9,
        type: 'procedural',
        stale: false,
        createdAt: 0,
        updatedAt: 0,
      },
    ];
    vi.spyOn(mockMemoryStore, 'search').mockReturnValue(lexicalHits);
    vi.spyOn(mockEmbedder, 'embedTexts').mockRejectedValue(new Error('Vector DB is down'));

    await expect(searchService.search(request)).rejects.toThrow(
      'Vector search failed: Vector DB is down',
    );
  });

  it('throws on unsupported search mode', async () => {
    const request = {
      query: 'test',
      mode: 'unsupported',
      topKFinal: 5,
    } as unknown as MemorySearchRequest;

    await expect(searchService.search(request)).rejects.toThrow(
      'Unsupported search mode: unsupported',
    );
  });
});
