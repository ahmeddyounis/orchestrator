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
import { FileMeta } from './store/types';

const MAX_FILE_SIZE_BYTES = 1 * 1024 * 1024; // 1MB

export interface SemanticIndexUpdaterConfig {
  repoRoot: string;
  repoId: string;
  embedder: Embedder;
  maxFileSizeBytes?: number;
}

export class SemanticIndexUpdater {
  private readonly store: SemanticIndexStore;
  private readonly chunker: SemanticChunker;
  private readonly scanner: RepoScanner;

  constructor() {
    this.store = new SemanticIndexStore();
    this.chunker = new SemanticChunker();
    this.scanner = new RepoScanner();
  }

  async update(config: SemanticIndexUpdaterConfig): Promise<void> {
    const startTime = Date.now();
    emitter.emit('semanticIndexUpdateStarted', { repoId: config.repoId });

    const dbPath = resolve(config.repoRoot, '.orchestrator', 'semantic.sqlite');
    this.store.init(dbPath);

    const meta = this.store.getMeta();
    const embedderId = config.embedder.id();
    const dims = config.embedder.dims();

    if (!meta || meta.embedderId !== embedderId || meta.dims !== dims) {
      this.store.close();
      throw new Error('Embedder configuration has changed. Please rebuild the index.');
    }

    const { files: currentFiles } = await this.scanner.scan(config.repoRoot);
    const existingFileMetas = this.store.getAllFiles();
    const existingFiles = new Map<string, FileMeta>(existingFileMetas.map((f) => [f.path, f]));

    let changedFiles = 0;
    let removedFiles = 0;

    // Process current files to find new or modified ones
    for (const file of currentFiles) {
      const filePath = resolve(config.repoRoot, file.path);
      const fileStat = await stat(filePath);
      const existingFile = existingFiles.get(file.path);

      if (
        existingFile &&
        existingFile.mtimeMs === fileStat.mtimeMs &&
        existingFile.sizeBytes === fileStat.size
      ) {
        continue;
      }

      if (fileStat.size > (config.maxFileSizeBytes ?? MAX_FILE_SIZE_BYTES)) {
        continue;
      }

      const fileHash = await hashFile(filePath);
      if (existingFile && existingFile.fileHash === fileHash) {
        continue;
      }

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
      this.store.replaceChunksForFile(file.path, chunks);

      if (chunks.length > 0) {
        const contentsToEmbed = chunks.map((c) => c.content);
        const embeddings = await config.embedder.embedTexts(contentsToEmbed);

        const embeddingMap = new Map<string, Float32Array>();
        for (let i = 0; i < chunks.length; i++) {
          embeddingMap.set(chunks[i].chunkId, new Float32Array(embeddings[i]));
        }
        this.store.upsertEmbeddings(embeddingMap);
      }
      changedFiles++;
    }

    // Find and process deleted files
    const currentFileSet = new Set(currentFiles.map((f) => f.path));
    for (const path of existingFiles.keys()) {
      if (!currentFileSet.has(path)) {
        this.store.deleteFile(path);
        removedFiles++;
      }
    }

    this.store.setMeta({ ...meta, updatedAt: Date.now() });
    this.store.close();

    emitter.emit('semanticIndexUpdateFinished', {
      repoId: config.repoId,
      changedFiles,
      removedFiles,
      durationMs: Date.now() - startTime,
    });
  }
}
