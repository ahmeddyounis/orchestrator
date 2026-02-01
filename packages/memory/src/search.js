'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.MemorySearchService = void 0;
const shared_1 = require('@orchestrator/shared');
const ranking_1 = require('./ranking');
class MemorySearchService {
  deps;
  constructor(deps) {
    this.deps = deps;
  }
  async search(request) {
    switch (request.mode) {
      case 'lexical':
        return this.lexicalSearch(request);
      case 'vector':
        return this.vectorSearch(request);
      case 'hybrid':
        return this.hybridSearch(request);
      default:
        throw new shared_1.MemoryError(`Unsupported search mode: ${request.mode}`);
    }
  }
  async lexicalSearch(request) {
    const { query, topKFinal } = request;
    const { memoryStore, repoId } = this.deps;
    const hits = memoryStore
      .search(repoId, query, {
        topK: topKFinal,
      })
      .filter((hit) => hit.integrityStatus !== 'blocked');
    return {
      methodUsed: 'lexical',
      hits,
      events: [],
    };
  }
  async vectorSearch(request) {
    const { query, topKFinal, topKVector = 10 } = request;
    const { vectorBackend, embedder, repoId } = this.deps;
    const queryVectors = await embedder.embedTexts([query]);
    const queryVector = queryVectors[0];
    const vectorHits = await vectorBackend.query(
      {},
      repoId,
      new Float32Array(queryVector),
      topKVector,
    );
    const hits = await this.hydrateVectorHits(vectorHits);
    return {
      methodUsed: 'vector',
      hits: hits.slice(0, topKFinal),
      events: [],
    };
  }
  async hybridSearch(request) {
    const {
      query,
      topKLexical = 10,
      topKVector = 10,
      fallbackToLexicalOnVectorError,
      topKFinal,
    } = request;
    const { embedder, repoId, vectorBackend } = this.deps;
    const events = [];
    const lexicalResult = await this.lexicalSearch({
      ...request,
      mode: 'lexical',
      topKFinal: topKLexical,
    });
    let vectorHits = [];
    try {
      const queryVectors = await embedder.embedTexts([query]);
      const queryVector = queryVectors[0];
      const rawVectorHits = await vectorBackend.query(
        {},
        repoId,
        new Float32Array(queryVector),
        topKVector,
      );
      vectorHits = await this.hydrateVectorHits(rawVectorHits);
    } catch (error) {
      events.push('VectorSearchFailed');
      if (fallbackToLexicalOnVectorError) {
        events.push('VectorSearchFailedFallback');
        return {
          ...lexicalResult,
          methodUsed: 'lexical', // It was hybrid, but fell back
          events,
        };
      } else {
        throw new shared_1.MemoryError(`Vector search failed: ${error.message}`);
      }
    }
    const lexicalHits = lexicalResult.hits;
    const combined = (0, ranking_1.rerankHybrid)(lexicalHits, vectorHits, request);
    return {
      methodUsed: 'hybrid',
      hits: combined.slice(0, topKFinal),
      events,
    };
  }
  entryToBaseHit(entry) {
    return {
      id: entry.id,
      type: entry.type,
      stale: entry.stale ?? false,
      title: entry.title,
      content: entry.content,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      integrityStatus: entry.integrityStatus,
      integrityReasonsJson: entry.integrityReasonsJson,
    };
  }
  async hydrateVectorHits(vectorHits) {
    const { memoryStore } = this.deps;
    const hydrated = [];
    for (const hit of vectorHits) {
      const entry = memoryStore.get(hit.id);
      if (entry && entry.integrityStatus !== 'blocked') {
        hydrated.push({
          ...this.entryToBaseHit(entry),
          vectorScore: hit.score,
        });
      }
    }
    return hydrated;
  }
}
exports.MemorySearchService = MemorySearchService;
//# sourceMappingURL=search.js.map
