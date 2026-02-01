"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalHashEmbedder = void 0;
const crypto_1 = require("crypto");
class LocalHashEmbedder {
    dimensions;
    constructor(dimensions = 256) {
        this.dimensions = dimensions;
    }
    async embedTexts(texts) {
        return texts.map((text) => this.embedText(text));
    }
    dims() {
        return this.dimensions;
    }
    id() {
        return `local-hash-dim${this.dimensions}`;
    }
    embedText(text) {
        const hash = (0, crypto_1.createHash)('sha256').update(text).digest();
        const vector = [];
        for (let i = 0; i < this.dimensions; i++) {
            const byteIndex = i % hash.length;
            const bitIndex = Math.floor(i / hash.length) % 8;
            const byte = hash[byteIndex];
            const bit = (byte >> bitIndex) & 1;
            vector.push(bit);
        }
        return vector;
    }
}
exports.LocalHashEmbedder = LocalHashEmbedder;
