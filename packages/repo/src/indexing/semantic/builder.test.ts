import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SemanticIndexBuilder, SemanticIndexBuilderConfig } from './builder';
import { emitter } from '../../events';
import type { Embedder } from '@orchestrator/adapters';

// Mock dependencies
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  stat: vi.fn(),
}));

vi.mock('../../scanner', () => ({
  RepoScanner: vi.fn().mockImplementation(() => ({
    scan: vi.fn(),
  })),
}));

vi.mock('../hasher', () => ({
  hashFile: vi.fn(),
}));

vi.mock('./chunker', () => ({
  SemanticChunker: vi.fn().mockImplementation(() => ({
    chunk: vi.fn(),
  })),
}));

vi.mock('./store', () => ({
  SemanticIndexStore: vi.fn().mockImplementation(() => ({
    init: vi.fn(),
    upsertFileMeta: vi.fn(),
    replaceChunksForFile: vi.fn(),
    upsertEmbeddings: vi.fn(),
    setMeta: vi.fn(),
    close: vi.fn(),
  })),
}));

vi.mock('../../tree-sitter', () => ({
  getLanguageForFile: vi.fn(),
}));

vi.mock('../../events', () => ({
  emitter: {
    emit: vi.fn(),
  },
}));

import * as fsPromises from 'node:fs/promises';
import { RepoScanner } from '../../scanner';
import { hashFile } from '../hasher';
import { SemanticChunker } from './chunker';
import { SemanticIndexStore } from './store';
import { getLanguageForFile } from '../../tree-sitter';

const mockReadFile = vi.mocked(fsPromises.readFile);
const mockStat = vi.mocked(fsPromises.stat);
const mockHashFile = vi.mocked(hashFile);
const mockGetLanguageForFile = vi.mocked(getLanguageForFile);
const mockEmitterEmit = vi.mocked(emitter.emit);

describe('SemanticIndexBuilder', () => {
  let builder: SemanticIndexBuilder;
  let mockScanner: { scan: ReturnType<typeof vi.fn> };
  let mockChunker: { chunk: ReturnType<typeof vi.fn> };
  let mockStore: {
    init: ReturnType<typeof vi.fn>;
    upsertFileMeta: ReturnType<typeof vi.fn>;
    replaceChunksForFile: ReturnType<typeof vi.fn>;
    upsertEmbeddings: ReturnType<typeof vi.fn>;
    setMeta: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };
  let mockEmbedder: Embedder;

  beforeEach(() => {
    vi.clearAllMocks();

    builder = new SemanticIndexBuilder();

    // Get the mocked instances
    mockScanner = (RepoScanner as unknown as ReturnType<typeof vi.fn>).mock.results[0].value;
    mockChunker = (SemanticChunker as unknown as ReturnType<typeof vi.fn>).mock.results[0].value;
    mockStore = (SemanticIndexStore as unknown as ReturnType<typeof vi.fn>).mock.results[0].value;

    mockEmbedder = {
      embedTexts: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
      dims: vi.fn().mockReturnValue(3),
      id: vi.fn().mockReturnValue('test-embedder'),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createConfig(overrides: Partial<SemanticIndexBuilderConfig> = {}): SemanticIndexBuilderConfig {
    return {
      repoRoot: '/test/repo',
      repoId: 'test-repo',
      embedder: mockEmbedder,
      ...overrides,
    };
  }

  describe('build', () => {
    it('should emit build started and finished events', async () => {
      mockScanner.scan.mockResolvedValue({ files: [] });

      await builder.build(createConfig());

      expect(mockEmitterEmit).toHaveBeenCalledWith('semanticIndexBuildStarted', {
        repoId: 'test-repo',
      });
      expect(mockEmitterEmit).toHaveBeenCalledWith('semanticIndexBuildFinished', {
        repoId: 'test-repo',
        filesProcessed: 0,
        chunksEmbedded: 0,
        durationMs: expect.any(Number),
      });
    });

    it('should initialize the store with correct path', async () => {
      mockScanner.scan.mockResolvedValue({ files: [] });

      await builder.build(createConfig());

      expect(mockStore.init).toHaveBeenCalledWith('/test/repo/.orchestrator/semantic.sqlite');
    });

    it('should skip files larger than maxFileSizeBytes', async () => {
      mockScanner.scan.mockResolvedValue({
        files: [{ path: 'large-file.ts' }],
      });
      mockStat.mockResolvedValue({ size: 2 * 1024 * 1024, mtimeMs: Date.now() } as unknown as ReturnType<typeof fsPromises.stat>);

      await builder.build(createConfig({ maxFileSizeBytes: 1024 * 1024 }));

      expect(mockHashFile).not.toHaveBeenCalled();
      expect(mockStore.upsertFileMeta).not.toHaveBeenCalled();
    });

    it('should use default maxFileSizeBytes of 1MB when not specified', async () => {
      mockScanner.scan.mockResolvedValue({
        files: [{ path: 'large-file.ts' }],
      });
      // File is 1.5MB, should be skipped with default 1MB limit
      mockStat.mockResolvedValue({ size: 1.5 * 1024 * 1024, mtimeMs: Date.now() } as unknown as ReturnType<typeof fsPromises.stat>);

      await builder.build(createConfig());

      expect(mockHashFile).not.toHaveBeenCalled();
    });

    it('should skip files without a supported language', async () => {
      mockScanner.scan.mockResolvedValue({
        files: [{ path: 'readme.md' }],
      });
      mockStat.mockResolvedValue({ size: 100, mtimeMs: Date.now() } as unknown as ReturnType<typeof fsPromises.stat>);
      mockHashFile.mockResolvedValue('hash123');
      mockGetLanguageForFile.mockReturnValue(null);

      await builder.build(createConfig());

      expect(mockStore.upsertFileMeta).not.toHaveBeenCalled();
    });

    it('should process files with supported languages', async () => {
      const testContent = 'function test() { console.log("hello"); }';
      mockScanner.scan.mockResolvedValue({
        files: [{ path: 'src/test.ts' }],
      });
      mockStat.mockResolvedValue({ size: 100, mtimeMs: 1234567890 } as unknown as ReturnType<typeof fsPromises.stat>);
      mockHashFile.mockResolvedValue('filehash123');
      mockGetLanguageForFile.mockReturnValue('typescript');
      mockReadFile.mockResolvedValue(testContent);
      mockChunker.chunk.mockReturnValue([
        {
          chunkId: 'chunk1',
          path: 'src/test.ts',
          language: 'typescript',
          kind: 'function',
          name: 'test',
          startLine: 0,
          endLine: 0,
          content: testContent,
          parentName: null,
          fileHash: 'filehash123',
        },
      ]);

      await builder.build(createConfig());

      expect(mockStore.upsertFileMeta).toHaveBeenCalledWith({
        path: 'src/test.ts',
        fileHash: 'filehash123',
        language: 'typescript',
        mtimeMs: 1234567890,
        sizeBytes: 100,
      });
      expect(mockStore.replaceChunksForFile).toHaveBeenCalledWith('src/test.ts', expect.any(Array));
    });

    it('should skip files with no chunks', async () => {
      mockScanner.scan.mockResolvedValue({
        files: [{ path: 'src/empty.ts' }],
      });
      mockStat.mockResolvedValue({ size: 100, mtimeMs: Date.now() } as unknown as ReturnType<typeof fsPromises.stat>);
      mockHashFile.mockResolvedValue('hash123');
      mockGetLanguageForFile.mockReturnValue('typescript');
      mockReadFile.mockResolvedValue('');
      mockChunker.chunk.mockReturnValue([]);

      await builder.build(createConfig());

      expect(mockStore.replaceChunksForFile).not.toHaveBeenCalled();
      expect(mockEmbedder.embedTexts).not.toHaveBeenCalled();
    });

    it('should embed chunk contents and store embeddings', async () => {
      const chunks = [
        { chunkId: 'chunk1', content: 'function a() {}', path: 'test.ts', language: 'typescript', kind: 'function', name: 'a', startLine: 0, endLine: 0, parentName: null, fileHash: 'hash1' },
        { chunkId: 'chunk2', content: 'function b() {}', path: 'test.ts', language: 'typescript', kind: 'function', name: 'b', startLine: 1, endLine: 1, parentName: null, fileHash: 'hash1' },
      ];

      mockScanner.scan.mockResolvedValue({
        files: [{ path: 'test.ts' }],
      });
      mockStat.mockResolvedValue({ size: 100, mtimeMs: Date.now() } as unknown as ReturnType<typeof fsPromises.stat>);
      mockHashFile.mockResolvedValue('hash1');
      mockGetLanguageForFile.mockReturnValue('typescript');
      mockReadFile.mockResolvedValue('function a() {}\nfunction b() {}');
      mockChunker.chunk.mockReturnValue(chunks);
      (mockEmbedder.embedTexts as ReturnType<typeof vi.fn>).mockResolvedValue([
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6],
      ]);

      await builder.build(createConfig());

      expect(mockEmbedder.embedTexts).toHaveBeenCalledWith([
        'function a() {}',
        'function b() {}',
      ]);
      expect(mockStore.upsertEmbeddings).toHaveBeenCalled();
      const embeddingCall = mockStore.upsertEmbeddings.mock.calls[0][0] as Map<string, Float32Array>;
      expect(embeddingCall.size).toBe(2);
      expect(embeddingCall.has('chunk1')).toBe(true);
      expect(embeddingCall.has('chunk2')).toBe(true);
    });

    it('should stop processing when maxChunksPerBuild is exceeded', async () => {
      const chunk1 = { chunkId: 'chunk1', content: 'content1', path: 'file1.ts', language: 'typescript', kind: 'function', name: 'a', startLine: 0, endLine: 0, parentName: null, fileHash: 'h1' };
      const chunk2 = { chunkId: 'chunk2', content: 'content2', path: 'file2.ts', language: 'typescript', kind: 'function', name: 'b', startLine: 0, endLine: 0, parentName: null, fileHash: 'h2' };

      mockScanner.scan.mockResolvedValue({
        files: [{ path: 'file1.ts' }, { path: 'file2.ts' }, { path: 'file3.ts' }],
      });
      mockStat.mockResolvedValue({ size: 100, mtimeMs: Date.now() } as unknown as ReturnType<typeof fsPromises.stat>);
      mockHashFile.mockResolvedValue('hash');
      mockGetLanguageForFile.mockReturnValue('typescript');
      mockReadFile.mockResolvedValue('content');
      mockChunker.chunk
        .mockReturnValueOnce([chunk1])
        .mockReturnValueOnce([chunk2])
        .mockReturnValueOnce([{ chunkId: 'chunk3', content: 'content3' }]);
      (mockEmbedder.embedTexts as ReturnType<typeof vi.fn>).mockResolvedValue([[0.1]]);

      await builder.build(createConfig({ maxChunksPerBuild: 1 }));

      // Should process file1 (1 chunk) and file2 (cumulative 2 chunks > 1, but loop continues to end of that iteration)
      // After file2, chunksEmbedded = 2, which is > maxChunksPerBuild (1), so loop breaks before file3
      expect(mockChunker.chunk).toHaveBeenCalledTimes(2);
    });

    it('should set metadata after processing', async () => {
      mockScanner.scan.mockResolvedValue({ files: [] });

      await builder.build(createConfig());

      expect(mockStore.setMeta).toHaveBeenCalledWith({
        repoId: 'test-repo',
        repoRoot: '/test/repo',
        embedderId: 'test-embedder',
        dims: 3,
        builtAt: expect.any(Number),
        updatedAt: expect.any(Number),
      });
    });

    it('should close the store after build', async () => {
      mockScanner.scan.mockResolvedValue({ files: [] });

      await builder.build(createConfig());

      expect(mockStore.close).toHaveBeenCalled();
    });

    it('should report correct filesProcessed and chunksEmbedded counts', async () => {
      const chunks = [
        { chunkId: 'c1', content: 'a', path: 'f.ts', language: 'typescript', kind: 'function', name: 'a', startLine: 0, endLine: 0, parentName: null, fileHash: 'h' },
        { chunkId: 'c2', content: 'b', path: 'f.ts', language: 'typescript', kind: 'function', name: 'b', startLine: 1, endLine: 1, parentName: null, fileHash: 'h' },
      ];

      mockScanner.scan.mockResolvedValue({
        files: [{ path: 'file1.ts' }, { path: 'file2.ts' }],
      });
      mockStat.mockResolvedValue({ size: 100, mtimeMs: Date.now() } as unknown as ReturnType<typeof fsPromises.stat>);
      mockHashFile.mockResolvedValue('hash');
      mockGetLanguageForFile.mockReturnValue('typescript');
      mockReadFile.mockResolvedValue('content');
      mockChunker.chunk.mockReturnValue(chunks);
      (mockEmbedder.embedTexts as ReturnType<typeof vi.fn>).mockResolvedValue([[0.1], [0.2]]);

      await builder.build(createConfig());

      expect(mockEmitterEmit).toHaveBeenCalledWith('semanticIndexBuildFinished', {
        repoId: 'test-repo',
        filesProcessed: 2,
        chunksEmbedded: 4, // 2 files × 2 chunks each
        durationMs: expect.any(Number),
      });
    });

    it('should process multiple files in sequence', async () => {
      mockScanner.scan.mockResolvedValue({
        files: [{ path: 'a.ts' }, { path: 'b.ts' }],
      });
      mockStat.mockResolvedValue({ size: 50, mtimeMs: Date.now() } as unknown as ReturnType<typeof fsPromises.stat>);
      mockHashFile.mockResolvedValue('hash');
      mockGetLanguageForFile.mockReturnValue('typescript');
      mockReadFile.mockResolvedValue('code');
      mockChunker.chunk.mockReturnValue([
        { chunkId: 'c', content: 'x', path: 'p', language: 'typescript', kind: 'function', name: 'n', startLine: 0, endLine: 0, parentName: null, fileHash: 'h' },
      ]);
      (mockEmbedder.embedTexts as ReturnType<typeof vi.fn>).mockResolvedValue([[0.1]]);

      await builder.build(createConfig());

      expect(mockStore.upsertFileMeta).toHaveBeenCalledTimes(2);
      expect(mockStore.replaceChunksForFile).toHaveBeenCalledTimes(2);
      expect(mockEmbedder.embedTexts).toHaveBeenCalledTimes(2);
      expect(mockStore.upsertEmbeddings).toHaveBeenCalledTimes(2);
