"use strict";
// packages/adapters/src/embed/embed.test.ts
Object.defineProperty(exports, "__esModule", { value: true });
const local_hash_embedder_1 = require("./local_hash_embedder");
describe('LocalHashEmbedder', () => {
    it('should be deterministic', async () => {
        const embedder = new local_hash_embedder_1.LocalHashEmbedder();
        const embeddings1 = await embedder.embedTexts(['hello world']);
        const embeddings2 = await embedder.embedTexts(['hello world']);
        expect(embeddings1).toEqual(embeddings2);
    });
    it('should have the correct dimensions', async () => {
        const embedder = new local_hash_embedder_1.LocalHashEmbedder(128);
        const embeddings = await embedder.embedTexts(['hello world']);
        expect(embeddings[0]).toHaveLength(128);
        expect(embedder.dims()).toBe(128);
    });
    it('should produce different embeddings for different texts', async () => {
        const embedder = new local_hash_embedder_1.LocalHashEmbedder();
        const embeddings1 = await embedder.embedTexts(['hello world']);
        const embeddings2 = await embedder.embedTexts(['hello there']);
        expect(embeddings1).not.toEqual(embeddings2);
    });
    it('should produce normalized vectors', async () => {
        const embedder = new local_hash_embedder_1.LocalHashEmbedder();
        const embeddings = await embedder.embedTexts(['hello world']);
        const norm = Math.sqrt(embeddings[0].reduce((sum, val) => sum + val * val, 0));
        expect(norm).toBeCloseTo(1);
    });
});
//# sourceMappingURL=embed.test.js.map