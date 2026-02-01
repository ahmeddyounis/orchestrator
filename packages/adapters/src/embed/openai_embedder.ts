// packages/adapters/src/embed/openai_embedder.ts

import OpenAI, { APIError } from 'openai';
import { Embedder } from './embedder';
import { ConfigError, RateLimitError } from '../errors';

export interface OpenAIEmbedderConfig {
  apiKey?: string;
  apiKeyEnv?: string;
  model?: string;
  dimensions?: number;
}

export class OpenAIEmbedder implements Embedder {
  private client: OpenAI;
  private model: string;
  private dimensions?: number;

  constructor(config: OpenAIEmbedderConfig) {
    const apiKey = config.apiKey || (config.apiKeyEnv && process.env[config.apiKeyEnv]);
    if (!apiKey) {
      throw new ConfigError(
        `Missing API Key for OpenAI provider. Checked config.apiKey and env var ${config.apiKeyEnv}`,
      );
    }
    this.model = config.model || 'text-embedding-3-small';
    this.dimensions = config.dimensions;
    this.client = new OpenAI({
      apiKey,
    });
  }

  async embedTexts(texts: string[]): Promise<number[][]> {
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

  dims(): number {
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

  id(): string {
    return `openai:${this.model}`;
  }

  private mapError(error: unknown): Error {
    if (error instanceof APIError) {
      if (error.status === 429) {
        return new RateLimitError(error.message);
      }
      if (error.status === 401) {
        return new ConfigError(error.message);
      }
    }
    if (error instanceof Error) return error;
    return new Error(String(error));
  }
}
