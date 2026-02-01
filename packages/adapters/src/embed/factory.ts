import { Embedder } from './embedder';
import { OpenAIEmbedder } from './openai_embedder';
import { LocalHashEmbedder } from './local_hash_embedder';
import { EmbeddingsConfig } from '@orchestrator/shared';
import { CachingEmbedder } from './caching_embedder';

export function createEmbedder(config: EmbeddingsConfig): Embedder {
  let embedder: Embedder;
  switch (config.provider) {
    case 'openai':
      embedder = new OpenAIEmbedder({
        apiKey: process.env.OPENAI_API_KEY!,
        model: config.model,
      });
      break;
    case 'local-hash':
      embedder = new LocalHashEmbedder(config.dims);
      break;
    default:
      throw new Error(`Unsupported embedder provider: ${config.provider}`);
  }

  return new CachingEmbedder(embedder);
}
