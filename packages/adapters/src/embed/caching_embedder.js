"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CachingEmbedder = void 0;
const ohash_1 = require("ohash");
class CachingEmbedder {
    underlyingEmbedder;
    cache = new Map();
    constructor(underlyingEmbedder) {
        this.underlyingEmbedder = underlyingEmbedder;
    }
    async embedTexts(texts) {
        const cacheKey = (0, ohash_1.objectHash)(texts);
        if (this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey);
        }
        const embeddings = await this.underlyingEmbedder.embedTexts(texts);
        this.cache.set(cacheKey, embeddings);
        return embeddings;
    }
    dims() {
        return this.underlyingEmbedder.dims();
    }
    id() {
        return `cached(${this.underlyingEmbedder.id()})`;
    }
}
exports.CachingEmbedder = CachingEmbedder;
