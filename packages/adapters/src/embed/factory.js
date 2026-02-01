"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEmbedder = createEmbedder;
const openai_embedder_1 = require("./openai_embedder");
const local_hash_embedder_1 = require("./local_hash_embedder");
const caching_embedder_1 = require("./caching_embedder");
function createEmbedder(config) {
    let embedder;
    switch (config.provider) {
        case 'openai':
            embedder = new openai_embedder_1.OpenAIEmbedder({
                apiKey: process.env.OPENAI_API_KEY,
                model: config.model,
            });
            break;
        case 'local-hash':
            embedder = new local_hash_embedder_1.LocalHashEmbedder(config.dims);
            break;
        default:
            throw new Error(`Unsupported embedder provider: ${config.provider}`);
    }
    return new caching_embedder_1.CachingEmbedder(embedder);
}
