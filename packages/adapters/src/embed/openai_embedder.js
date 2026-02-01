'use strict';
// packages/adapters/src/embed/openai_embedder.ts
var __createBinding =
  (this && this.__createBinding) ||
  (Object.create
    ? function (o, m, k, k2) {
        if (k2 === undefined) k2 = k;
        var desc = Object.getOwnPropertyDescriptor(m, k);
        if (!desc || ('get' in desc ? !m.__esModule : desc.writable || desc.configurable)) {
          desc = {
            enumerable: true,
            get: function () {
              return m[k];
            },
          };
        }
        Object.defineProperty(o, k2, desc);
      }
    : function (o, m, k, k2) {
        if (k2 === undefined) k2 = k;
        o[k2] = m[k];
      });
var __setModuleDefault =
  (this && this.__setModuleDefault) ||
  (Object.create
    ? function (o, v) {
        Object.defineProperty(o, 'default', { enumerable: true, value: v });
      }
    : function (o, v) {
        o['default'] = v;
      });
var __importStar =
  (this && this.__importStar) ||
  (function () {
    var ownKeys = function (o) {
      ownKeys =
        Object.getOwnPropertyNames ||
        function (o) {
          var ar = [];
          for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
          return ar;
        };
      return ownKeys(o);
    };
    return function (mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null)
        for (var k = ownKeys(mod), i = 0; i < k.length; i++)
          if (k[i] !== 'default') __createBinding(result, mod, k[i]);
      __setModuleDefault(result, mod);
      return result;
    };
  })();
Object.defineProperty(exports, '__esModule', { value: true });
exports.OpenAIEmbedder = void 0;
const openai_1 = __importStar(require('openai'));
const errors_1 = require('../errors');
class OpenAIEmbedder {
  client;
  model;
  dimensions;
  constructor(config) {
    const apiKey = config.apiKey || (config.apiKeyEnv && process.env[config.apiKeyEnv]);
    if (!apiKey) {
      throw new errors_1.ConfigError(
        `Missing API Key for OpenAI provider. Checked config.apiKey and env var ${config.apiKeyEnv}`,
      );
    }
    this.model = config.model || 'text-embedding-3-small';
    this.dimensions = config.dimensions;
    this.client = new openai_1.default({
      apiKey,
    });
  }
  async embedTexts(texts) {
    try {
      const response = await this.client.embeddings.create({
        model: this.model,
        input: texts,
        dimensions: this.dimensions,
      });
      // The OpenAI library guarantees the embeddings will be in the same order as the inputs.
      return response.data.map((d) => d.embedding);
    } catch (error) {
      throw this.mapError(error);
    }
  }
  dims() {
    if (this.dimensions) {
      return this.dimensions;
    }
    // default for text-embedding-3-small
    if (this.model === 'text-embedding-3-small') {
      return 1536;
    }
    // default for text-embedding-3-large
    if (this.model === 'text-embedding-3-large') {
      return 3072;
    }
    return 0; // Unknown
  }
  id() {
    return `openai:${this.model}`;
  }
  mapError(error) {
    if (error instanceof openai_1.APIError) {
      if (error.status === 429) {
        return new errors_1.RateLimitError(error.message);
      }
      if (error.status === 401) {
        return new errors_1.ConfigError(error.message);
      }
    }
    if (error instanceof Error) return error;
    return new Error(String(error));
  }
}
exports.OpenAIEmbedder = OpenAIEmbedder;
//# sourceMappingURL=openai_embedder.js.map
