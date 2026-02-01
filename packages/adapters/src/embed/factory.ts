import { Embedder } from './embedder';
import { OpenAIEmbedder } from './openai_embedder';
import { LocalHashEmbedder } from './local_hash_embedder';
import { EmbeddingsConfig } from '@orchestrator/shared';

export function createEmbedder(config: EmbeddingsConfig): Embedder {
  switch (config.provider) {
    case 'openai':
      return new OpenAIEmbedder({
        apiKey: process.env.OPENAI_API_KEY!,
        model: config.model,
      });
    case 'local-hash':
      return new LocalHashEmbedder(config.dims);
    default:
      throw new Error(`Unsupported embedder provider: ${config.provider}`);
  }
}
