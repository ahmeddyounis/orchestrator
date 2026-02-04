import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';
import type { Embedder } from '@orchestrator/adapters';
import { SemanticIndexBuilder } from './builder';
import { emitter } from '../../events';
import { RepoScanner } from '../../scanner';
import { hashFile } from '../hasher';
import { SemanticChunker } from './chunker';
import { SemanticIndexStore } from './store';
import { getLanguageForFile } from '../../tree-sitter';
import * as fsPromises from 'node:fs/promises';

let lastScanner: any;
let lastChunker: any;
let lastStore: any;

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  stat: vi.fn(),
}));

vi.mock('../../scanner', () => ({
  RepoScanner: class RepoScanner {
    scan = vi.fn();
    constructor() {
      lastScanner = this;
    }
  },
}));

vi.mock('../hasher', () => ({
  hashFile: vi.fn(),
}));

vi.mock('./chunker', () => ({
  SemanticChunker: class SemanticChunker {
    chunk = vi.fn();
    constructor() {
      lastChunker = this;
    }
  },
}));

vi.mock('./store', () => ({
  SemanticIndexStore: class SemanticIndexStore {
    init = vi.fn();
    upsertFileMeta = vi.fn();
    replaceChunksForFile = vi.fn();
    upsertEmbeddings = vi.fn();
    setMeta = vi.fn();
    close = vi.fn();
    constructor() {
      lastStore = this;
    }
  },
}));

vi.mock('../../tree-sitter', () => ({
  getLanguageForFile: vi.fn(),
}));

vi.mock('../../events', () => ({
  emitter: {
    emit: vi.fn(),
  },
}));

describe('SemanticIndexBuilder', () => {
  const mockReadFile = vi.mocked(fsPromises.readFile);
  const mockStat = vi.mocked(fsPromises.stat);
  const mockHashFile = vi.mocked(hashFile);
  const mockGetLanguageForFile = vi.mocked(getLanguageForFile);
  const mockEmitterEmit = vi.mocked(emitter.emit);

  const mockEmbedder: Embedder = {
    id: () => 'test-embedder',
    dims: () => 1,
    embedTexts: vi.fn(),
  } as any;

  const repoRoot = '/repo';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds embeddings and writes metadata for a file', async () => {
    mockStat.mockResolvedValue({ size: 10, mtimeMs: 123 } as any);
    mockHashFile.mockResolvedValue('hash');
    mockGetLanguageForFile.mockReturnValue('typescript' as any);
    mockReadFile.mockResolvedValue('content');
    vi.mocked(mockEmbedder.embedTexts).mockResolvedValue([[0.1], [0.2]]);

    const builder = new SemanticIndexBuilder();
    lastScanner.scan.mockResolvedValue({ files: [{ path: 'src/a.ts' }] });
    lastChunker.chunk.mockReturnValue([
      { chunkId: 'c1', content: 'one' },
      { chunkId: 'c2', content: 'two' },
    ] as any);

    await builder.build({ repoRoot, repoId: 'test-repo', embedder: mockEmbedder });

    expect(lastStore.init).toHaveBeenCalledWith(
      path.resolve(repoRoot, '.orchestrator', 'semantic.sqlite'),
    );

    expect(lastStore.upsertFileMeta).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'src/a.ts',
        fileHash: 'hash',
        language: 'typescript',
      }),
    );

    expect(lastStore.replaceChunksForFile).toHaveBeenCalledWith('src/a.ts', expect.any(Array));
    expect(mockEmbedder.embedTexts).toHaveBeenCalledWith(['one', 'two']);

    expect(lastStore.setMeta).toHaveBeenCalledWith(
      expect.objectContaining({
        repoId: 'test-repo',
        repoRoot,
        embedderId: 'test-embedder',
        dims: 1,
      }),
    );

    expect(mockEmitterEmit).toHaveBeenCalledWith('semanticIndexBuildStarted', {
      repoId: 'test-repo',
    });
    expect(mockEmitterEmit).toHaveBeenCalledWith(
      'semanticIndexBuildFinished',
      expect.objectContaining({
        repoId: 'test-repo',
        filesProcessed: 1,
        chunksEmbedded: 2,
      }),
    );
  });

  it('skips files when language cannot be determined', async () => {
    mockStat.mockResolvedValue({ size: 10, mtimeMs: 123 } as any);
    mockHashFile.mockResolvedValue('hash');
    mockGetLanguageForFile.mockReturnValue(undefined as any);

    const builder = new SemanticIndexBuilder();
    lastScanner.scan.mockResolvedValue({ files: [{ path: 'src/unknown.ext' }] });

    await builder.build({ repoRoot, repoId: 'test-repo', embedder: mockEmbedder });

    expect(mockEmbedder.embedTexts).not.toHaveBeenCalled();
    expect(mockEmitterEmit).toHaveBeenCalledWith(
      'semanticIndexBuildFinished',
      expect.objectContaining({ filesProcessed: 0, chunksEmbedded: 0 }),
    );
  });

  it('respects maxChunksPerBuild', async () => {
    mockStat.mockResolvedValue({ size: 10, mtimeMs: 123 } as any);
    mockHashFile.mockResolvedValue('hash');
    mockGetLanguageForFile.mockReturnValue('typescript' as any);
    mockReadFile.mockResolvedValue('content');
    vi.mocked(mockEmbedder.embedTexts).mockResolvedValue([[0.1], [0.2]]);

    const builder = new SemanticIndexBuilder();
    lastScanner.scan.mockResolvedValue({ files: [{ path: 'a.ts' }, { path: 'b.ts' }] });
    lastChunker.chunk.mockReturnValue([
      { chunkId: 'c1', content: 'one' },
      { chunkId: 'c2', content: 'two' },
    ] as any);

    await builder.build({
      repoRoot,
      repoId: 'test-repo',
      embedder: mockEmbedder,
      maxChunksPerBuild: 1,
    });

    // Only the first file should be processed because chunksEmbedded(2) > maxChunksPerBuild(1) triggers break.
    expect(lastStore.upsertFileMeta).toHaveBeenCalledTimes(1);
    expect(mockEmbedder.embedTexts).toHaveBeenCalledTimes(1);
  });
});
