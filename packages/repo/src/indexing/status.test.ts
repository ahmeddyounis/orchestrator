import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getIndexStatus } from './status';
import * as store from './store';
import { RepoScanner } from '../scanner';
import { OrchestratorConfig, ConfigSchema } from '@orchestrator/shared';

vi.mock('./store');

const mockedStore = vi.mocked(store);

const baseConfig: OrchestratorConfig = {
  ...ConfigSchema.parse({}),
  rootDir: '/app',
  orchestratorDir: '/app/.orchestrator',
  indexing: {
    enabled: true,
    path: '.orchestrator/index/index.json',
    mode: 'on-demand',
    hashAlgorithm: 'sha256',
    maxFileSizeBytes: 2000000,
    ignore: [],
  },
};

const mockDate = new Date('2026-01-29T10:00:00.000Z');

const baseIndex = {
  version: '1',
  repoRoot: '/app',
  builtAt: mockDate.getTime() - 10000,
  updatedAt: mockDate.getTime() - 5000,
  stats: { fileCount: 2, textFileCount: 2, hashedCount: 2, byLanguage: {} },
  files: [
    {
      path: 'file1.ts',
      mtimeMs: 1000,
      sizeBytes: 100,
      sha256: 'h1',
      isText: true,
    },
    {
      path: 'file2.ts',
      mtimeMs: 2000,
      sizeBytes: 200,
      sha256: 'h2',
      isText: true,
    },
  ],
};

describe('getIndexStatus', () => {
  let scanSpy: any;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(mockDate);
    scanSpy = vi
      .spyOn(RepoScanner.prototype, 'scan')
      .mockResolvedValue({ repoRoot: '/app', files: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetAllMocks();
    scanSpy.mockRestore();
  });

  it('should report isIndexed: false when no index is found', async () => {
    mockedStore.loadIndex.mockReturnValue(null);
    const status = await getIndexStatus(baseConfig);
    expect(status.isIndexed).toBe(false);
  });

  it('should report no drift when index and files match', async () => {
    mockedStore.loadIndex.mockReturnValue(baseIndex as any);
    scanSpy.mockResolvedValue({
      repoRoot: '/app',
      files: [
        {
          path: 'file1.ts',
          absPath: '/app/file1.ts',
          mtimeMs: 1000,
          sizeBytes: 100,
          isText: true,
          ext: '.ts',
        },
        {
          path: 'file2.ts',
          absPath: '/app/file2.ts',
          mtimeMs: 2000,
          sizeBytes: 200,
          isText: true,
          ext: '.ts',
        },
      ],
    });

    const status = await getIndexStatus(baseConfig);

    expect(status.isIndexed).toBe(true);
    expect(status.drift).toEqual({
      hasDrift: false,
      changedCount: 0,
      addedCount: 0,
      removedCount: 0,
      changes: {
        added: [],
        removed: [],
        modified: [],
      },
    });
    expect(status.fileCount).toBe(2);
    expect(status.hashedCount).toBe(2);
  });

  it('should detect changed files', async () => {
    mockedStore.loadIndex.mockReturnValue(baseIndex as any);
    scanSpy.mockResolvedValue({
      repoRoot: '/app',
      files: [
        {
          path: 'file1.ts',
          absPath: '/app/file1.ts',
          mtimeMs: 1001,
          sizeBytes: 100,
          isText: true,
          ext: '.ts',
        }, // changed
        {
          path: 'file2.ts',
          absPath: '/app/file2.ts',
          mtimeMs: 2000,
          sizeBytes: 200,
          isText: true,
          ext: '.ts',
        },
      ],
    });

    const status = await getIndexStatus(baseConfig);

    expect(status.drift?.changedCount).toBe(1);
    expect(status.drift?.changes.modified).toEqual(['file1.ts']);
  });

  it('should detect added files', async () => {
    mockedStore.loadIndex.mockReturnValue(baseIndex as any);
    scanSpy.mockResolvedValue({
      repoRoot: '/app',
      files: [
        {
          path: 'file1.ts',
          absPath: '/app/file1.ts',
          mtimeMs: 1000,
          sizeBytes: 100,
          isText: true,
          ext: '.ts',
        },
        {
          path: 'file2.ts',
          absPath: '/app/file2.ts',
          mtimeMs: 2000,
          sizeBytes: 200,
          isText: true,
          ext: '.ts',
        },
        {
          path: 'file3.ts',
          absPath: '/app/file3.ts',
          mtimeMs: 3000,
          sizeBytes: 300,
          isText: true,
          ext: '.ts',
        }, // added
      ],
    });

    const status = await getIndexStatus(baseConfig);

    expect(status.drift?.addedCount).toBe(1);
  });

  it('should detect removed files', async () => {
    mockedStore.loadIndex.mockReturnValue(baseIndex as any);
    scanSpy.mockResolvedValue({
      repoRoot: '/app',
      files: [
        {
          path: 'file1.ts',
          absPath: '/app/file1.ts',
          mtimeMs: 1000,
          sizeBytes: 100,
          isText: true,
          ext: '.ts',
        },
        // file2.ts removed
      ],
    });

    const status = await getIndexStatus(baseConfig);

    expect(status.drift?.removedCount).toBe(1);
  });

  it('should handle a mix of changes', async () => {
    mockedStore.loadIndex.mockReturnValue({
      ...baseIndex,
      stats: { ...baseIndex.stats, fileCount: 3 },
      files: [
        ...baseIndex.files,
        {
          path: 'file-to-remove.ts',
          mtimeMs: 500,
          sizeBytes: 50,
          sha256: 'h-remove',
          isText: true,
        },
      ],
    } as any);
    scanSpy.mockResolvedValue({
      repoRoot: '/app',
      files: [
        {
          path: 'file1.ts',
          absPath: '/app/file1.ts',
          mtimeMs: 1001,
          sizeBytes: 100,
          isText: true,
          ext: '.ts',
        }, // changed
        {
          path: 'file2.ts',
          absPath: '/app/file2.ts',
          mtimeMs: 2000,
          sizeBytes: 200,
          isText: true,
          ext: '.ts',
        },
        {
          path: 'file-added.ts',
          absPath: '/app/file-added.ts',
          mtimeMs: 3000,
          sizeBytes: 300,
          isText: true,
          ext: '.ts',
        }, // added
      ],
    });

    const status = await getIndexStatus(baseConfig);

    expect(status.drift).toEqual({
      hasDrift: true,
      changedCount: 1,
      addedCount: 1,
      removedCount: 1,
      changes: {
        added: ['file-added.ts'],
        removed: ['file-to-remove.ts'],
        modified: ['file1.ts'],
      },
    });
  });
});