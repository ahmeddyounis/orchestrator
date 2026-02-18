import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  readFileSpy,
  statSpy,
  scanSpy,
  hashFileSpy,
  chunkSpy,
  storeInitSpy,
  storeGetMetaSpy,
  storeCloseSpy,
  storeGetAllFilesSpy,
  storeUpsertFileMetaSpy,
  storeReplaceChunksForFileSpy,
  storeUpsertEmbeddingsSpy,
  storeDeleteFileSpy,
  storeSetMetaSpy,
  emitterEmitSpy,
  getLanguageForFileSpy,
} = vi.hoisted(() => ({
  readFileSpy: vi.fn(),
  statSpy: vi.fn(),
  scanSpy: vi.fn(),
  hashFileSpy: vi.fn(),
  chunkSpy: vi.fn(),
  storeInitSpy: vi.fn(),
  storeGetMetaSpy: vi.fn(),
  storeCloseSpy: vi.fn(),
  storeGetAllFilesSpy: vi.fn(),
  storeUpsertFileMetaSpy: vi.fn(),
  storeReplaceChunksForFileSpy: vi.fn(),
  storeUpsertEmbeddingsSpy: vi.fn(),
  storeDeleteFileSpy: vi.fn(),
  storeSetMetaSpy: vi.fn(),
  emitterEmitSpy: vi.fn(),
  getLanguageForFileSpy: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  readFile: readFileSpy,
  stat: statSpy,
}));

vi.mock('../../scanner', () => ({
  RepoScanner: class {
    scan = scanSpy;
  },
}));

vi.mock('../hasher', () => ({
  hashFile: hashFileSpy,
}));

vi.mock('./chunker', () => ({
  SemanticChunker: class {
    chunk = chunkSpy;
  },
}));

vi.mock('./store', () => ({
  SemanticIndexStore: class {
    init = storeInitSpy;
    getMeta = storeGetMetaSpy;
    close = storeCloseSpy;
    getAllFiles = storeGetAllFilesSpy;
    upsertFileMeta = storeUpsertFileMetaSpy;
    replaceChunksForFile = storeReplaceChunksForFileSpy;
    upsertEmbeddings = storeUpsertEmbeddingsSpy;
    deleteFile = storeDeleteFileSpy;
    setMeta = storeSetMetaSpy;
  },
}));

vi.mock('../../tree-sitter', () => ({
  getLanguageForFile: getLanguageForFileSpy,
}));

vi.mock('../../events', () => ({
  emitter: {
    emit: emitterEmitSpy,
  },
}));

import { SemanticIndexUpdater } from './updater';

describe('SemanticIndexUpdater', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, 'now').mockReturnValue(1000);
  });

  it('throws when index metadata is missing or incompatible', async () => {
    storeGetMetaSpy.mockReturnValueOnce(null);

    const updater = new SemanticIndexUpdater();
    await expect(
      updater.update({
        repoRoot: '/repo',
        repoId: 'repo-1',
        embedder: {
          id: () => 'embedder-1',
          dims: () => 2,
          embedTexts: vi.fn(),
        } as any,
      }),
    ).rejects.toThrow(/Embedder configuration has changed/i);

    expect(emitterEmitSpy).toHaveBeenCalledWith('semanticIndexUpdateStarted', { repoId: 'repo-1' });
    expect(storeCloseSpy).toHaveBeenCalled();
  });

  it('skips unchanged/invalid files and updates changed and removed files', async () => {
    storeGetMetaSpy.mockReturnValueOnce({
      repoId: 'repo-1',
      repoRoot: '/repo',
      embedderId: 'embedder-1',
      dims: 2,
      builtAt: 1,
      updatedAt: 1,
    });

    storeGetAllFilesSpy.mockReturnValueOnce([
      {
        path: 'unchanged.ts',
        fileHash: 'h-unchanged',
        language: 'typescript',
        mtimeMs: 1,
        sizeBytes: 10,
      },
      {
        path: 'same-hash.ts',
        fileHash: 'h-same',
        language: 'typescript',
        mtimeMs: 1,
        sizeBytes: 10,
      },
      {
        path: 'removed.ts',
        fileHash: 'h-removed',
        language: 'typescript',
        mtimeMs: 1,
        sizeBytes: 10,
      },
    ]);

    scanSpy.mockResolvedValueOnce({
      repoRoot: '/repo',
      warnings: [],
      files: [
        { path: 'unchanged.ts' },
        { path: 'too-big.ts' },
        { path: 'same-hash.ts' },
        { path: 'unknown-lang.bin' },
        { path: 'no-chunks.ts' },
        { path: 'with-chunks.ts' },
      ],
    } as any);

    statSpy.mockImplementation(async (filePath: string) => {
      if (filePath.endsWith('unchanged.ts')) return { mtimeMs: 1, size: 10 } as any;
      if (filePath.endsWith('too-big.ts')) return { mtimeMs: 2, size: 1001 } as any;
      if (filePath.endsWith('same-hash.ts')) return { mtimeMs: 2, size: 11 } as any;
      if (filePath.endsWith('unknown-lang.bin')) return { mtimeMs: 2, size: 11 } as any;
      if (filePath.endsWith('no-chunks.ts')) return { mtimeMs: 2, size: 11 } as any;
      if (filePath.endsWith('with-chunks.ts')) return { mtimeMs: 2, size: 11 } as any;
      throw new Error(`unexpected stat for ${filePath}`);
    });

    hashFileSpy.mockImplementation(async (filePath: string) => {
      if (filePath.endsWith('same-hash.ts')) return 'h-same';
      if (filePath.endsWith('no-chunks.ts')) return 'h-no-chunks';
      if (filePath.endsWith('with-chunks.ts')) return 'h-with-chunks';
      return 'h-other';
    });

    getLanguageForFileSpy.mockImplementation((p: string) => {
      if (p.endsWith('.bin')) return undefined;
      return 'typescript';
    });

    readFileSpy.mockResolvedValue('content');

    chunkSpy.mockImplementation((input: { path: string }) => {
      if (input.path === 'no-chunks.ts') return [];
      if (input.path === 'with-chunks.ts') {
        return [
          { chunkId: 'k1', content: 'c1' },
          { chunkId: 'k2', content: 'c2' },
        ] as any;
      }
      return [] as any;
    });

    const embedTextsSpy = vi.fn().mockResolvedValue([
      [1, 0],
      [0, 1],
    ]);

    const updater = new SemanticIndexUpdater();
    await updater.update({
      repoRoot: '/repo',
      repoId: 'repo-1',
      embedder: {
        id: () => 'embedder-1',
        dims: () => 2,
        embedTexts: embedTextsSpy,
      } as any,
      maxFileSizeBytes: 1000,
    });

    expect(storeUpsertFileMetaSpy).toHaveBeenCalledTimes(2);
    expect(storeReplaceChunksForFileSpy).toHaveBeenCalledWith('no-chunks.ts', []);
    expect(storeReplaceChunksForFileSpy).toHaveBeenCalledWith(
      'with-chunks.ts',
      expect.arrayContaining([expect.objectContaining({ chunkId: 'k1' })]),
    );

    expect(embedTextsSpy).toHaveBeenCalledWith(['c1', 'c2']);
    expect(storeUpsertEmbeddingsSpy).toHaveBeenCalledWith(expect.any(Map));

    expect(storeDeleteFileSpy).toHaveBeenCalledWith('removed.ts');
    expect(storeSetMetaSpy).toHaveBeenCalledWith(expect.objectContaining({ updatedAt: 1000 }));
    expect(storeCloseSpy).toHaveBeenCalled();

    expect(emitterEmitSpy).toHaveBeenCalledWith(
      'semanticIndexUpdateFinished',
      expect.objectContaining({
        repoId: 'repo-1',
        changedFiles: 2,
        removedFiles: 1,
      }),
    );
  });
});
