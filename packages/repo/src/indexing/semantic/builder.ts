import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'path';

import { Embedder } from '@orchestrator/adapters';
import { RepoScanner } from '../../scanner';
import { hashFile } from '../hasher';
import { SemanticChunker } from './chunker';
import { SemanticIndexStore } from './store';
import { FileInput } from './types';
import { getLanguageForFile } from '../../tree-sitter';
import { emitter } from '../../events';

const MAX_FILE_SIZE_BYTES = 1 * 1024 * 1024; // 1MB

export interface SemanticIndexBuilderConfig {
  repoRoot: string;
  repoId: string;
  embedder: Embedder;
  maxFileSizeBytes?: number;
  maxChunksPerBuild?: number;
}

export class SemanticIndexBuilder {
  private readonly store: SemanticIndexStore;
  private readonly chunker: SemanticChunker;
  private readonly scanner: RepoScanner;

  constructor() {
    this.store = new SemanticIndexStore();
    this.chunker = new SemanticChunker();
    this.scanner = new RepoScanner();
  }

  async build(config: SemanticIndexBuilderConfig): Promise<void> {
    const startTime = Date.now();
    emitter.emit('semanticIndexBuildStarted', { repoId: config.repoId });

    this.store.init(resolve(config.repoRoot, '.orchestrator', 'semantic.sqlite'));

    const { files } = await this.scanner.scan(config.repoRoot);
    let filesProcessed = 0;
    let chunksEmbedded = 0;

    for (const file of files) {
      const filePath = resolve(config.repoRoot, file.path);
      const fileStat = await stat(filePath);

      if (fileStat.size > (config.maxFileSizeBytes ?? MAX_FILE_SIZE_BYTES)) {
        continue;
      }

      const fileHash = await hashFile(filePath);
      const language = getLanguageForFile(file.path);
      if (!language) {
        continue;
      }

      this.store.upsertFileMeta({
        path: file.path,
        fileHash,
        language,
        mtimeMs: fileStat.mtimeMs,
        sizeBytes: fileStat.size,
      });

      const content = await readFile(filePath, 'utf-8');
      const fileInput: FileInput = {
        path: file.path,
        content,
        language,
        fileHash,
      };

      const chunks = this.chunker.chunk(fileInput);
      if (chunks.length === 0) {
        continue;
      }

      filesProcessed++;

      this.store.replaceChunksForFile(file.path, chunks);

      const contentsToEmbed = chunks.map((c) => c.content);
      const embeddings = await config.embedder.embedTexts(contentsToEmbed);

      const embeddingMap = new Map<string, Float32Array>();
      for (let i = 0; i < chunks.length; i++) {
        embeddingMap.set(chunks[i].chunkId, new Float32Array(embeddings[i]));
      }
      this.store.upsertEmbeddings(embeddingMap);
      chunksEmbedded += chunks.length;

      if (config.maxChunksPerBuild && chunksEmbedded > config.maxChunksPerBuild) {
        break;
      }
    }

    const embedderId = config.embedder.id();
    const dims = config.embedder.dims();
    const now = Date.now();
    this.store.setMeta({
      repoId: config.repoId,
      repoRoot: config.repoRoot,
      embedderId,
      dims,
      builtAt: now,
      updatedAt: now,
    });

    this.store.close();

    emitter.emit('semanticIndexBuildFinished', {
      repoId: config.repoId,
      filesProcessed,
      chunksEmbedded,
      durationMs: Date.now() - startTime,
    });
  }
}
