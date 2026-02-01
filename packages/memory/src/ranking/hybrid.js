'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.rerankHybrid = rerankHybrid;
function rerankHybrid(lexicalHits, vectorHits, options) {
  const allHits = new Map();
  lexicalHits.forEach((hit) => {
    allHits.set(hit.id, { ...hit });
  });
  vectorHits.forEach((hit) => {
    const existing = allHits.get(hit.id);
    if (existing) {
      existing.vectorScore = hit.vectorScore;
    } else {
      allHits.set(hit.id, { ...hit });
    }
  });
  const processedHits = Array.from(allHits.values()).map((hit) => {
    const lexicalScore = hit.lexicalScore ?? 0;
    const vectorScore = hit.vectorScore ?? 0;
    // Normalize scores - assuming FTS gives 1 or 0, and vector score is cosine similarity [0,1]
    const normalizedLexical = lexicalScore;
    const normalizedVector = vectorScore;
    let combinedScore = 0.5 * normalizedLexical + 0.5 * normalizedVector;
    // Apply bonuses and penalties
    if (options.staleDownrank && hit.stale) {
      combinedScore *= 0.1;
    }
    if (options.proceduralBoost && hit.type === 'procedural') {
      combinedScore *= 1.5;
    }
    if (
      options.episodicBoostFailureSignature &&
      hit.type === 'episodic' &&
      hit.title?.includes(options.episodicBoostFailureSignature)
    ) {
      combinedScore *= 1.3;
    }
    return {
      ...hit,
      id: hit.id,
      type: hit.type,
      stale: hit.stale,
      title: hit.title,
      content: hit.content,
      lexicalScore,
      vectorScore,
      combinedScore,
      createdAt: hit.createdAt,
      updatedAt: hit.updatedAt,
    };
  });
  processedHits.sort((a, b) => b.combinedScore - a.combinedScore);
  return processedHits;
}
//# sourceMappingURL=hybrid.js.map
