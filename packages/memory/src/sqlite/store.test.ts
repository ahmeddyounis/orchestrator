import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createMemoryStore, MemoryStore } from './store';
import type { MemoryEntry } from '../types';
import * as fs from 'fs';
import * as path from 'path';

const DB_PATH = path.join(__dirname, 'test.db');

describe('SQLite MemoryStore', () => {
  let store: MemoryStore;

  beforeEach(() => {
    if (fs.existsSync(DB_PATH)) {
      fs.unlinkSync(DB_PATH);
    }
    store = createMemoryStore();
    store.init(DB_PATH);
  });

  afterEach(() => {
    store.close();
    if (fs.existsSync(DB_PATH)) {
      fs.unlinkSync(DB_PATH);
    }
  });

  it('should initialize and create the database file', () => {
    expect(fs.existsSync(DB_PATH)).toBe(true);
  });

  it('should upsert a new memory entry', () => {
    const entry: MemoryEntry = {
      id: 'test-1',
      repoId: 'repo-1',
      type: 'procedural',
      title: 'Test Title',
      content: 'Test Content',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    store.upsert(entry);
    const result = store.get('test-1');

    expect(result).not.toBeNull();
    expect(result?.id).toBe('test-1');
    expect(result?.title).toBe('Test Title');
  });

  it('should update an existing memory entry on upsert', () => {
    const now = Date.now();
    const entry: MemoryEntry = {
      id: 'test-1',
      repoId: 'repo-1',
      type: 'procedural',
      title: 'Test Title',
      content: 'Test Content',
      createdAt: now,
      updatedAt: now,
    };
    store.upsert(entry);

    const updatedEntry: MemoryEntry = {
      ...entry,
      title: 'Updated Title',
      updatedAt: Date.now(),
    };
    store.upsert(updatedEntry);

    const result = store.get('test-1');
    expect(result?.title).toBe('Updated Title');
  });

  it('should list entries by repoId', () => {
    const entry1: MemoryEntry = {
      id: 'test-1',
      repoId: 'repo-1',
      type: 'procedural',
      title: 'Title 1',
      content: 'Content 1',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const entry2: MemoryEntry = {
      id: 'test-2',
      repoId: 'repo-1',
      type: 'episodic',
      title: 'Title 2',
      content: 'Content 2',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const entry3: MemoryEntry = {
      id: 'test-3',
      repoId: 'repo-2',
      type: 'semantic',
      title: 'Title 3',
      content: 'Content 3',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    store.upsert(entry1);
    store.upsert(entry2);
    store.upsert(entry3);

    const results = store.list('repo-1');
    expect(results.length).toBe(2);
    expect(results.map(r => r.id).sort()).toEqual(['test-1', 'test-2']);
  });

  it('should perform a full-text search', () => {
    const entry1: MemoryEntry = {
      id: 'test-1',
      repoId: 'repo-1',
      type: 'procedural',
      title: 'VSCode setup',
      content: 'How to configure your Visual Studio Code environment.',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const entry2: MemoryEntry = {
      id: 'test-2',
      repoId: 'repo-1',
      type: 'episodic',
      title: 'Team meeting notes',
      content: 'Discussed the new feature for our VSCode extension.',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    store.upsert(entry1);
    store.upsert(entry2);

    const results = store.search('repo-1', 'VSCode');
    expect(results.length).toBe(2);
  });

  it('should wipe all entries for a given repoId', () => {
    const entry1: MemoryEntry = {
      id: 'test-1',
      repoId: 'repo-1',
      type: 'procedural',
      title: 'Title 1',
      content: 'Content 1',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    store.upsert(entry1);

    const entry2: MemoryEntry = {
      id: 'test-2',
      repoId: 'repo-2',
      type: 'procedural',
      title: 'Title 2',
      content: 'Content 2',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    store.upsert(entry2);

    store.wipe('repo-1');

    expect(store.get('test-1')).toBeNull();
    expect(store.get('test-2')).not.toBeNull();
  });
});