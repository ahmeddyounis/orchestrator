"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEmbedder = createEmbedder;
const openai_embedder_1 = require("./openai_embedder");
const local_hash_embedder_1 = require("./local_hash_embedder");
function createEmbedder(config) {
    switch (config.provider) {
        case 'openai':
            return new openai_embedder_1.OpenAIEmbedder({
                apiKey: process.env.OPENAI_API_KEY,
                model: config.model,
            });
        case 'local-hash':
            return new local_hash_embedder_1.LocalHashEmbedder(config.dims);
        default:
            throw new Error(`Unsupported embedder provider: ${config.provider}`);
    }
}
//# sourceMappingURL=factory.js.map