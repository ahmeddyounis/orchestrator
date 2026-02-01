"use strict";
// packages/adapters/src/embed/local_hash_embedder.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalHashEmbedder = void 0;
const crypto_1 = require("crypto");
class LocalHashEmbedder {
    dimensions;
    constructor(dimensions = 384) {
        this.dimensions = dimensions;
    }
    async embedTexts(texts) {
        return texts.map((text) => {
            const normalizedText = text.trim().toLowerCase();
            const hash = (0, crypto_1.createHash)('sha256').update(normalizedText).digest();
            const floatArray = new Array(this.dimensions).fill(0);
            for (let i = 0; i < this.dimensions; i++) {
                const hashIndex = i % hash.length;
                floatArray[i] = hash.readUInt8(hashIndex) / 255.0;
            }
            return this.l2Normalize(floatArray);
        });
    }
    dims() {
        return this.dimensions;
    }
    id() {
        return `local-hash:${this.dimensions}`;
    }
    l2Normalize(arr) {
        const sumOfSquares = arr.reduce((sum, val) => sum + val * val, 0);
        const norm = Math.sqrt(sumOfSquares);
        if (norm === 0) {
            return arr;
        }
        return arr.map((val) => val / norm);
    }
}
exports.LocalHashEmbedder = LocalHashEmbedder;
//# sourceMappingURL=local_hash_embedder.js.map