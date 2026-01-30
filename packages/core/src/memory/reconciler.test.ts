import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { MemoryEntry, MemoryStore } from '@orchestrator/memory';
import type { Index, IndexFile } from '@orchestrator/repo';
import { reconcileMemoryStaleness } from './reconciler';

const mockMemoryStore = (): MemoryStore => ({
  init: vi.fn(),
  upsert: vi.fn(),
  search: vi.fn(),
  get: vi.fn(),
  list: vi.fn(),
  listEntriesForRepo: vi.fn(),
  updateStaleFlag: vi.fn(),
  wipe: vi.fn(),
  status: vi.fn(),
  close: vi.fn(),
});

describe('reconcileMemoryStaleness', () => {
  let memoryStore: MemoryStore;

  beforeEach(() => {
    memoryStore = mockMemoryStore();
  });

  const createIndex = (files: { path: string; sha256: string }[]): Index => ({
    version: '1',
    repoRoot: '/test',
    builtAt: new Date(),
    updatedAt: new Date(),
    stats: {
      fileCount: files.length,
      textFileCount: files.length,
      hashedCount: files.length,
      byLanguage: {},
    },
    files: files.map(
      (f): IndexFile => ({
        ...f,
        sizeBytes: 100,
        mtimeMs: Date.now(),
        isText: true,
      }),
    ),
  });

  const createEntry = (
    id: string,
    fileRefs: string[],
    fileHashes: Record<string, string>,
    stale: boolean,
  ): MemoryEntry => ({
    id,
    repoId: 'test-repo',
    type: 'procedural',
    title: `Entry ${id}`,
    content: '...',
    fileRefsJson: JSON.stringify(fileRefs),
    fileHashesJson: JSON.stringify(fileHashes),
    stale,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  it('should not mark anything if no entries have file refs', async () => {
    const index = createIndex([{ path: 'a.ts', sha256: 'hash-a' }]);
    (memoryStore.listEntriesForRepo as vi.Mock).mockReturnValue([
      { id: '1', stale: false },
    ]);

    const result = await reconcileMemoryStaleness(
      'test-repo',
      index,
      memoryStore,
    );

    expect(result).toEqual({ markedStaleCount: 0, clearedStaleCount: 0 });
    expect(memoryStore.updateStaleFlag).not.toHaveBeenCalled();
  });

  it('should mark an entry stale if a referenced file is missing from the index', async () => {
    const entry = createEntry('1', ['a.ts'], { 'a.ts': 'hash-a' }, false);
    const index = createIndex([]);
    (memoryStore.listEntriesForRepo as vi.Mock).mockReturnValue([entry]);

    const result = await reconcileMemoryStaleness(
      'test-repo',
      index,
      memoryStore,
    );

    expect(result).toEqual({ markedStaleCount: 1, clearedStaleCount: 0 });
    expect(memoryStore.updateStaleFlag).toHaveBeenCalledWith('1', true);
  });

  it('should mark an entry stale if a referenced file hash has changed', async () => {
    const entry = createEntry('1', ['a.ts'], { 'a.ts': 'hash-a-old' }, false);
    const index = createIndex([{ path: 'a.ts', sha256: 'hash-a-new' }]);
    (memoryStore.listEntriesForRepo as vi.Mock).mockReturnValue([entry]);

    const result = await reconcileMemoryStaleness(
      'test-repo',
      index,
      memoryStore,
    );

    expect(result).toEqual({ markedStaleCount: 1, clearedStaleCount: 0 });
    expect(memoryStore.updateStaleFlag).toHaveBeenCalledWith('1', true);
  });

  it('should clear the stale flag if a referenced file hash matches again', async () => {
    const entry = createEntry('1', ['a.ts'], { 'a.ts': 'hash-a' }, true);
    const index = createIndex([{ path: 'a.ts', sha256: 'hash-a' }]);
    (memoryStore.listEntriesForRepo as vi.Mock).mockReturnValue([entry]);

    const result = await reconcileMemoryStaleness(
      'test-repo',
      index,
      memoryStore,
    );

    expect(result).toEqual({ markedStaleCount: 0, clearedStaleCount: 1 });
    expect(memoryStore.updateStaleFlag).toHaveBeenCalledWith('1', false);
  });

  it('should not change stale status if hashes match and not stale', async () => {
    const entry = createEntry('1', ['a.ts'], { 'a.ts': 'hash-a' }, false);
    const index = createIndex([{ path: 'a.ts', sha256: 'hash-a' }]);
    (memoryStore.listEntriesForRepo as vi.Mock).mockReturnValue([entry]);

    const result = await reconcileMemoryStaleness(
      'test-repo',
      index,
      memoryStore,
    );

    expect(result).toEqual({ markedStaleCount: 0, clearedStaleCount: 0 });
    expect(memoryStore.updateStaleFlag).not.toHaveBeenCalled();
  });

  it('should not change stale status if hashes mismatch and already stale', async () => {
    const entry = createEntry('1', ['a.ts'], { 'a.ts': 'hash-a-old' }, true);
    const index = createIndex([{ path: 'a.ts', sha256: 'hash-a-new' }]);
    (memoryStore.listEntriesForRepo as vi.Mock).mockReturnValue([entry]);

    const result = await reconcileMemoryStaleness(
      'test-repo',
      index,
      memoryStore,
    );

    expect(result).toEqual({ markedStaleCount: 0, clearedStaleCount: 0 });
    expect(memoryStore.updateStaleFlag).not.toHaveBeenCalled();
  });

  it('should handle multiple entries correctly', async () => {
    const entry1Stale = createEntry(
      '1',
      ['a.ts'],
      { 'a.ts': 'hash-a-old' },
      false,
    );
    const entry2Clear = createEntry('2', ['b.ts'], { 'b.ts': 'hash-b' }, true);
    const entry3NoChange = createEntry(
      '3',
      ['c.ts'],
      { 'c.ts': 'hash-c' },
      false,
    );

    const index = createIndex([
      { path: 'a.ts', sha256: 'hash-a-new' },
      { path: 'b.ts', sha256: 'hash-b' },
      { path: 'c.ts', sha256: 'hash-c' },
    ]);
    (memoryStore.listEntriesForRepo as vi.Mock).mockReturnValue([
      entry1Stale,
      entry2Clear,
      entry3NoChange,
    ]);

    const result = await reconcileMemoryStaleness(
      'test-repo',
      index,
      memoryStore,
    );

    expect(result).toEqual({ markedStaleCount: 1, clearedStaleCount: 1 });
    expect(memoryStore.updateStaleFlag).toHaveBeenCalledWith('1', true);
    expect(memoryStore.updateStaleFlag).toHaveBeenCalledWith('2', false);
    expect(memoryStore.updateStaleFlag).not.toHaveBeenCalledWith(
      '3',
      expect.any(Boolean),
    );
  });
});
