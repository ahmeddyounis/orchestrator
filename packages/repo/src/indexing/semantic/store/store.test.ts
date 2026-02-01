// packages/repo/src/indexing/semantic/store/store.test.ts

import { SemanticIndexStore } from './store'
import { Chunk, FileMeta, SemanticIndexMeta } from './types'
import { rmSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SupportedLanguage } from '../../../tree-sitter'

const DB_PATH = 'test-semantic-index.db'

describe('SemanticIndexStore', () => {
  let store: SemanticIndexStore

  beforeEach(() => {
    rmSync(DB_PATH, { force: true })
    store = new SemanticIndexStore()
    store.init(DB_PATH)
  })

  afterEach(() => {
    store.close()
    rmSync(DB_PATH, { force: true })
  })

  it('should initialize and create tables', () => {
    const meta = store.getMeta()
    expect(meta).toBeNull()
  })

  it('should set and get meta', () => {
    const meta: SemanticIndexMeta = {
      repoId: 'test-repo',
      repoRoot: '/path/to/repo',
      embedderId: 'test-embedder',
      dims: 4,
      builtAt: Date.now(),
      updatedAt: Date.now(),
    }
    store.setMeta(meta)
    const retrievedMeta = store.getMeta()
    expect(retrievedMeta).toEqual({ ...meta, schemaVersion: 1 })
  })

  it('should upsert file meta', () => {
    const fileMeta: FileMeta = {
      path: 'src/index.ts',
      fileHash: 'hash123',
      language: 'typescript' as SupportedLanguage,
      mtimeMs: 12345,
      sizeBytes: 100,
    }
    store.upsertFileMeta(fileMeta)
    // No query method for file meta, so we trust the insert worked if no error.
  })

  it('should delete a file and its chunks/embeddings', () => {
    const fileMeta: FileMeta = {
      path: 'src/index.ts',
      fileHash: 'hash123',
      language: 'typescript' as SupportedLanguage,
      mtimeMs: 12345,
      sizeBytes: 100,
    }
    store.upsertFileMeta(fileMeta)

    const chunks: Chunk[] = [
      {
        chunkId: 'chunk1',
        path: 'src/index.ts',
        language: 'typescript' as SupportedLanguage,
        kind: 'function',
        name: 'myFunc',
        parentName: '',
        startLine: 1,
        endLine: 5,
        content: 'function myFunc() {}',
        fileHash: 'hash123',
      },
    ]
    store.replaceChunksForFile('src/index.ts', chunks)

    const embeddings = new Map<string, Float32Array>()
    embeddings.set('chunk1', new Float32Array([1, 2, 3, 4]))
    store.upsertEmbeddings(embeddings)

    expect(store.getAllEmbeddings().size).toBe(1)

    store.deleteFile('src/index.ts')

    expect(store.getAllEmbeddings().size).toBe(0)
  })

  it('should replace chunks for a file', () => {
    const fileMeta: FileMeta = {
      path: 'src/index.ts',
      fileHash: 'hash123',
      language: 'typescript' as SupportedLanguage,
      mtimeMs: 12345,
      sizeBytes: 100,
    }
    store.upsertFileMeta(fileMeta)

    const chunks1: Chunk[] = [
      {
        chunkId: 'chunk1',
        path: 'src/index.ts',
        language: 'typescript' as SupportedLanguage,
        kind: 'function',
        name: 'myFunc',
        parentName: '',
        startLine: 1,
        endLine: 5,
        content: 'function myFunc() {}',
        fileHash: 'hash123',
      },
    ]
    store.replaceChunksForFile('src/index.ts', chunks1)
    const embeddings1 = new Map<string, Float32Array>()
    embeddings1.set('chunk1', new Float32Array([1, 2, 3, 4]))
    store.upsertEmbeddings(embeddings1)
    expect(store.getAllEmbeddings().size).toBe(1)

    const chunks2: Chunk[] = [
      {
        chunkId: 'chunk2',
        path: 'src/index.ts',
        language: 'typescript' as SupportedLanguage,
        kind: 'function',
        name: 'anotherFunc',
        parentName: '',
        startLine: 6,
        endLine: 10,
        content: 'function anotherFunc() {}',
        fileHash: 'hash123',
      },
    ]
    store.replaceChunksForFile('src/index.ts', chunks2)
    const embeddings2 = new Map<string, Float32Array>()
    embeddings2.set('chunk2', new Float32Array([5, 6, 7, 8]))
    store.upsertEmbeddings(embeddings2)

    const allEmbeddings = store.getAllEmbeddings()
    expect(allEmbeddings.size).toBe(1)
    expect(allEmbeddings.has('chunk1')).toBe(false)
    expect(allEmbeddings.has('chunk2')).toBe(true)
  })

  it('should upsert and get all embeddings', () => {
    const embeddings = new Map<string, Float32Array>()
    const vector1 = new Float32Array([1, 2, 3, 4])
    const vector2 = new Float32Array([5, 6, 7, 8])
    embeddings.set('chunk1', vector1)
    embeddings.set('chunk2', vector2)

    store.upsertEmbeddings(embeddings)

    const retrievedEmbeddings = store.getAllEmbeddings()
    expect(retrievedEmbeddings.size).toBe(2)
    expect(retrievedEmbeddings.get('chunk1')).toEqual(vector1)
    expect(retrievedEmbeddings.get('chunk2')).toEqual(vector2)
  })
})
