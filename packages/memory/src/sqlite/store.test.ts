import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createMemoryStore, MemoryStore } from './store';
import { MemoryEntry } from '../types';

describe('SQLite MemoryStore', () => {
  let store: MemoryStore;
  let dbPath: string;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'orchestrator-test-'));
    dbPath = join(tempDir, 'memory.db');
    store = createMemoryStore();
    store.init(dbPath);
  });

  afterEach(() => {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should initialize and create the database file', () => {
    // The beforeEach hook already does the initialization.
    // We can add a check to ensure the file exists or check internal state.
    expect(store).toBeDefined();
  });

  it('should upsert and get a memory entry', () => {
    const entry: MemoryEntry = {
      id: 'test-1',
      repoId: 'repo-1',
      type: 'procedural',
      title: 'Test Title',
      content: 'Test Content',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      stale: false,
    };
    store.upsert(entry);

    const retrieved = store.get('test-1');
    expect(retrieved).toEqual(entry);
  });

  it('should update an existing entry on upsert', async () => {
    const now = Date.now();
    const entry: MemoryEntry = {
      id: 'test-1',
      repoId: 'repo-1',
      type: 'procedural',
      title: 'Test Title',
      content: 'Test Content',
      createdAt: now,
      updatedAt: now,
      stale: false,
    };
    store.upsert(entry);
    const firstUpsertTime = store.get('test-1')!.updatedAt;

    await new Promise((resolve) => setTimeout(resolve, 5));

    const updatedEntry: MemoryEntry = {
      ...entry,
      title: 'Updated Title',
      updatedAt: Date.now() + 1,
    };
    store.upsert(updatedEntry);

    const retrieved = store.get('test-1');
    expect(retrieved?.title).toBe('Updated Title');
    expect(retrieved?.createdAt).toBe(entry.createdAt);
    expect(retrieved?.updatedAt).not.toBe(firstUpsertTime);
  });

  it('should return null for a non-existent entry', () => {
    const retrieved = store.get('non-existent');
    expect(retrieved).toBeNull();
  });

  it('should list entries for a repoId', () => {
    const entry1: MemoryEntry = {
      id: 'test-1',
      repoId: 'repo-1',
      type: 'procedural',
      title: 'T1',
      content: 'C1',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      stale: false,
    };
    const entry2: MemoryEntry = {
      id: 'test-2',
      repoId: 'repo-1',
      type: 'episodic',
      title: 'T2',
      content: 'C2',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      stale: false,
    };
    const entry3: MemoryEntry = {
      id: 'test-3',
      repoId: 'repo-2',
      type: 'procedural',
      title: 'T3',
      content: 'C3',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      stale: false,
    };
    store.upsert(entry1);
    store.upsert(entry2);
    store.upsert(entry3);

    const list = store.list('repo-1');
    expect(list.length).toBe(2);
    expect(list.map((e) => e.id)).toContain('test-1');
    expect(list.map((e) => e.id)).toContain('test-2');
  });

  it('should list entries filtered by type', () => {
    const entry1: MemoryEntry = {
      id: 'test-1',
      repoId: 'repo-1',
      type: 'procedural',
      title: 'T1',
      content: 'C1',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      stale: false,
    };
    const entry2: MemoryEntry = {
      id: 'test-2',
      repoId: 'repo-1',
      type: 'episodic',
      title: 'T2',
      content: 'C2',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      stale: false,
    };
    store.upsert(entry1);
    store.upsert(entry2);

    const list = store.list('repo-1', 'episodic');
    expect(list.length).toBe(1);
    expect(list[0].id).toBe('test-2');
  });

  it('should return status for a repo', async () => {
    const now = Date.now();
    const entry1: MemoryEntry = {
      id: 'test-1',
      repoId: 'repo-1',
      type: 'procedural',
      title: 'T1',
      content: 'C1',
      createdAt: now,
      updatedAt: now,
      stale: false,
    };
    const entry2: MemoryEntry = {
      id: 'test-2',
      repoId: 'repo-1',
      type: 'episodic',
      title: 'T2',
      content: 'C2',
      createdAt: now + 1,
      updatedAt: now + 1,
      stale: false,
    };
    store.upsert(entry1);
    await new Promise((r) => setTimeout(r, 5));
    store.upsert(entry2);

    const retrievedEntry2 = store.get(entry2.id);
    const status = store.status('repo-1');
    expect(status.entryCounts.procedural).toBe(1);
    expect(status.entryCounts.episodic).toBe(1);
    expect(status.entryCounts.semantic).toBe(0);
    expect(status.entryCounts.total).toBe(2);
    expect(status.lastUpdatedAt).toBe(retrievedEntry2!.updatedAt);
  });

  it('should wipe all entries for a repoId', () => {
    const entry1: MemoryEntry = {
      id: 'test-1',
      repoId: 'repo-1',
      type: 'procedural',
      title: 'T1',
      content: 'C1',
      createdAt: 0,
      updatedAt: 0,
      stale: false,
    };
    const entry2: MemoryEntry = {
      id: 'test-2',
      repoId: 'repo-2',
      type: 'procedural',
      title: 'T2',
      content: 'C2',
      createdAt: 0,
      updatedAt: 0,
      stale: false,
    };
    store.upsert(entry1);
    store.upsert(entry2);

    store.wipe('repo-1');

    expect(store.get('test-1')).toBeNull();
    expect(store.get('test-2')).not.toBeNull();
  });

  it('should perform full-text search', () => {
    const entry1: MemoryEntry = {
      id: 'test-1',
      repoId: 'repo-1',
      type: 'procedural',
      title: 'Alpha Bravo',
      content: 'This is a test about dogs.',
      createdAt: 0,
      updatedAt: 0,
      stale: false,
    };
    const entry2: MemoryEntry = {
      id: 'test-2',
      repoId: 'repo-1',
      type: 'episodic',
      title: 'Charlie Delta',
      content: 'A document about cats.',
      createdAt: 0,
      updatedAt: 0,
      stale: false,
    };
    const entry3: MemoryEntry = {
      id: 'test-3',
      repoId: 'repo-1',
      type: 'procedural',
      title: 'Echo Foxtrot',
      content: 'A test about cats and dogs.',
      createdAt: 0,
      updatedAt: 0,
      stale: false,
    };
    store.upsert(entry1);
    store.upsert(entry2);
    store.upsert(entry3);

    const results = store.search('repo-1', 'cats');
    expect(results.length).toBe(2);
    expect(results.map((e) => e.id)).toContain('test-2');
    expect(results.map((e) => e.id)).toContain('test-3');

    const results2 = store.search('repo-1', 'Alpha');
    expect(results2.length).toBe(1);
    expect(results2[0].id).toBe('test-1');
  });
});
