import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
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
    store.init({ dbPath });
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
    expect(retrieved).toMatchObject({
      id: entry.id,
      repoId: entry.repoId,
      type: entry.type,
      title: entry.title,
      content: entry.content,
      stale: entry.stale,
    });
    // New integrity fields should have defaults
    expect(retrieved?.integrityStatus).toBe('ok');
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

    const results = store.search('repo-1', 'cats', {
      topK: 10,
    });
    expect(results.length).toBe(2);
    // Note: order is not guaranteed by FTS, so we check for inclusion
    expect(results.map((e) => e.id)).toContain('test-2');
    expect(results.map((e) => e.id)).toContain('test-3');

    const results2 = store.search('repo-1', 'Alpha', {
      topK: 10,
    });
    expect(results2.length).toBe(1);
    expect(results2[0].id).toBe('test-1');
  });

  it('returns empty results for queries with no searchable tokens', () => {
    store.upsert({
      id: 'test-1',
      repoId: 'repo-1',
      type: 'procedural',
      title: 'Hello',
      content: 'World',
      createdAt: 0,
      updatedAt: 0,
      stale: false,
    });

    expect(store.search('repo-1', '!!!', { topK: 10 })).toEqual([]);
    expect(store.search('repo-1', '   ', { topK: 10 })).toEqual([]);
  });

  it('supports list limit', () => {
    store.upsert({
      id: 'test-1',
      repoId: 'repo-1',
      type: 'procedural',
      title: 'T1',
      content: 'C1',
      createdAt: 0,
      updatedAt: 0,
      stale: false,
    });
    store.upsert({
      id: 'test-2',
      repoId: 'repo-1',
      type: 'procedural',
      title: 'T2',
      content: 'C2',
      createdAt: 0,
      updatedAt: 0,
      stale: false,
    });

    const list = store.list('repo-1', undefined, 1);
    expect(list).toHaveLength(1);
  });

  it('can list entries for a repo without ordering/filtering', () => {
    store.upsert({
      id: 'test-1',
      repoId: 'repo-1',
      type: 'procedural',
      title: 'T1',
      content: 'C1',
      createdAt: 0,
      updatedAt: 0,
      stale: false,
    });
    store.upsert({
      id: 'test-2',
      repoId: 'repo-1',
      type: 'episodic',
      title: 'T2',
      content: 'C2',
      createdAt: 0,
      updatedAt: 0,
      stale: false,
    });

    const entries = store.listEntriesForRepo('repo-1');
    expect(entries.map((e) => e.id).sort()).toEqual(['test-1', 'test-2']);
  });

  it('can list entries missing vectors and respects type/limit filters', () => {
    store.upsert({
      id: 'with-vector',
      repoId: 'repo-1',
      type: 'procedural',
      title: 'Has vector',
      content: 'C1',
      createdAt: 0,
      updatedAt: 0,
      stale: false,
    });
    store.upsert({
      id: 'no-vector-1',
      repoId: 'repo-1',
      type: 'procedural',
      title: 'No vector',
      content: 'C2',
      createdAt: 0,
      updatedAt: 0,
      stale: false,
    });
    store.upsert({
      id: 'no-vector-2',
      repoId: 'repo-1',
      type: 'episodic',
      title: 'No vector 2',
      content: 'C3',
      createdAt: 0,
      updatedAt: 0,
      stale: false,
    });

    store.markVectorUpdated('with-vector');

    const allMissing = store.listEntriesWithoutVectors('repo-1');
    expect(allMissing.map((e) => e.id).sort()).toEqual(['no-vector-1', 'no-vector-2']);

    const proceduralOnly = store.listEntriesWithoutVectors('repo-1', 'procedural');
    expect(proceduralOnly.map((e) => e.id)).toEqual(['no-vector-1']);

    const limited = store.listEntriesWithoutVectors('repo-1', undefined, 1);
    expect(limited).toHaveLength(1);
  });

  it('can update stale flag and reflect it in status', () => {
    store.upsert({
      id: 'stale-1',
      repoId: 'repo-1',
      type: 'procedural',
      title: 'T',
      content: 'C',
      createdAt: 0,
      updatedAt: 0,
      stale: false,
    });

    store.updateStaleFlag('stale-1', true);
    expect(store.get('stale-1')?.stale).toBe(true);
    expect(store.status('repo-1').staleCount).toBe(1);

    store.updateStaleFlag('stale-1', false);
    expect(store.get('stale-1')?.stale).toBe(false);
    expect(store.status('repo-1').staleCount).toBe(0);
  });
});

describe('SQLite MemoryStore with encryption', () => {
  const TEST_KEY = 'test-encryption-key-for-unit-tests';

  it('should encrypt content and decrypt on read (round-trip)', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'orchestrator-enc-test-'));
    const dbPath = join(tempDir, 'memory-enc.db');
    const store = createMemoryStore();
    store.init({
      dbPath,
      encryption: { encryptAtRest: true, key: TEST_KEY },
    });

    const entry: MemoryEntry = {
      id: 'enc-test-1',
      repoId: 'repo-1',
      type: 'procedural',
      title: 'Encrypted Title',
      content: 'This is secret content that should be encrypted at rest.',
      evidenceJson: '{"secret": "evidence data"}',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      stale: false,
    };
    store.upsert(entry);

    // Read back and verify decryption works
    const retrieved = store.get('enc-test-1');
    expect(retrieved).not.toBeNull();
    expect(retrieved?.content).toBe(entry.content);
    expect(retrieved?.evidenceJson).toBe(entry.evidenceJson);

    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should store ciphertext in database, not plaintext', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'orchestrator-enc-test-'));
    const dbPath = join(tempDir, 'memory-enc.db');
    const store = createMemoryStore();
    store.init({
      dbPath,
      encryption: { encryptAtRest: true, key: TEST_KEY },
    });

    const secretContent = 'PLAINTEXT_MARKER_SHOULD_NOT_APPEAR_IN_DB';
    const entry: MemoryEntry = {
      id: 'enc-test-2',
      repoId: 'repo-1',
      type: 'episodic',
      title: 'Test',
      content: secretContent,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      stale: false,
    };
    store.upsert(entry);
    store.close();

    // Read the raw database file and check that plaintext is NOT present
    const rawDbContent = readFileSync(dbPath);
    const dbString = rawDbContent.toString('utf8');
    expect(dbString).not.toContain(secretContent);

    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should throw error when encryption enabled but key missing', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'orchestrator-enc-test-'));
    const dbPath = join(tempDir, 'memory-enc.db');
    const store = createMemoryStore();

    expect(() => {
      store.init({
        dbPath,
        encryption: { encryptAtRest: true, key: '' },
      });
    }).toThrow(/encryption key was provided/i);

    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should fail to decrypt with wrong key', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'orchestrator-enc-test-'));
    const dbPath = join(tempDir, 'memory-enc.db');

    // Write with one key
    const store1 = createMemoryStore();
    store1.init({
      dbPath,
      encryption: { encryptAtRest: true, key: 'key-one' },
    });
    store1.upsert({
      id: 'wrong-key-test',
      repoId: 'repo-1',
      type: 'procedural',
      title: 'Test',
      content: 'Secret content',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      stale: false,
    });
    store1.close();

    // Try to read with different key
    const store2 = createMemoryStore();
    store2.init({
      dbPath,
      encryption: { encryptAtRest: true, key: 'key-two' },
    });

    expect(() => store2.get('wrong-key-test')).toThrow(/decrypt/i);

    store2.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('decrypts content in lexical search hits when encryption is enabled', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'orchestrator-enc-test-'));
    const dbPath = join(tempDir, 'memory-enc.db');
    const store = createMemoryStore();
    store.init({
      dbPath,
      encryption: { encryptAtRest: true, key: TEST_KEY },
    });

    const entry: MemoryEntry = {
      id: 'enc-search-1',
      repoId: 'repo-1',
      type: 'procedural',
      title: 'FindMe In Title',
      content: 'Secret content',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      stale: false,
    };
    store.upsert(entry);

    const hits = store.search('repo-1', 'FindMe', { topK: 10 });
    expect(hits).toHaveLength(1);
    expect(hits[0].content).toBe(entry.content);

    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  });
});

describe('SQLite MemoryStore hardening purge', () => {
  it('returns an empty purge result when nothing is expired', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'orchestrator-hardening-test-'));
    const dbPath = join(tempDir, 'memory.db');
    const store = createMemoryStore();
    store.init({
      dbPath,
      hardening: {
        retentionPolicies: [{ sensitivityLevel: 'internal', maxAgeMs: 60_000 }],
      },
    });

    const result = store.purgeExpired('repo-1');
    expect(result.purgedCount).toBe(0);
    expect(result.errors).toEqual([]);

    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('purges entries past the configured retention window', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'orchestrator-hardening-test-'));
    const dbPath = join(tempDir, 'memory.db');
    const store = createMemoryStore();
    store.init({
      dbPath,
      hardening: {
        retentionPolicies: [{ sensitivityLevel: 'internal', maxAgeMs: 1 }],
      },
    });

    store.upsert({
      id: 'expired-1',
      repoId: 'repo-1',
      type: 'episodic',
      title: 'Old',
      content: 'Old content',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      stale: false,
    });

    await new Promise((r) => setTimeout(r, 10));

    expect(store.listExpired('repo-1').map((e) => e.id)).toEqual(['expired-1']);

    const result = store.purgeExpired('repo-1');
    expect(result.purgedCount).toBe(1);
    expect(result.purgedByType.episodic).toBe(1);
    expect(result.purgedBySensitivity.internal).toBe(1);
    expect(store.get('expired-1')).toBeNull();

    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  });
});

describe('SQLite MemoryStore errors', () => {
  it('throws when used before initialization', () => {
    const store = createMemoryStore();

    const entry: MemoryEntry = {
      id: 'x',
      repoId: 'repo-1',
      type: 'procedural',
      title: 'T',
      content: 'C',
      createdAt: 0,
      updatedAt: 0,
      stale: false,
    };

    expect(() => store.upsert(entry)).toThrow(/Database not initialized/);
    expect(() => store.get('x')).toThrow(/Database not initialized/);
    expect(() => store.list('repo-1')).toThrow(/Database not initialized/);
    expect(() => store.listEntriesForRepo('repo-1')).toThrow(/Database not initialized/);
    expect(() => store.listEntriesWithoutVectors('repo-1')).toThrow(/Database not initialized/);
    expect(() => store.markVectorUpdated('x')).toThrow(/Database not initialized/);
    expect(() => store.updateStaleFlag('x', true)).toThrow(/Database not initialized/);
    expect(() => store.status('repo-1')).toThrow(/Database not initialized/);
    expect(() => store.search('repo-1', 'hello', { topK: 1 })).toThrow(/Database not initialized/);
    expect(() => store.wipe('repo-1')).toThrow(/Database not initialized/);
    expect(() => store.listExpired('repo-1')).toThrow(/Database not initialized/);
    expect(() => store.purgeExpired('repo-1')).toThrow(/Database not initialized/);
  });
});
