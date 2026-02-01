// packages/memory/src/vector/factory.ts
import { VectorMemoryBackend } from './backend';
import { NoopVectorMemoryBackend } from './noop';
import { VectorStorageConfig } from '../config';

export function createVectorMemoryBackend(config: VectorStorageConfig): VectorMemoryBackend {
  switch (config.provider) {
    case 'sqlite':
      // Placeholder for sqlite implementation
      throw new Error('SQLite vector backend not yet implemented.');
    case 'noop':
    default:
      return new NoopVectorMemoryBackend();
  }
}