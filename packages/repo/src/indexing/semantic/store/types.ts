// packages/repo/src/indexing/semantic/store/types.ts

import { SupportedLanguage } from '../../../tree-sitter'

export const SCHEMA_VERSION = 1

export interface SemanticIndexMeta {
  repoId: string
  repoRoot: string
  embedderId: string
  dims: number
  builtAt: number
  updatedAt: number
}

export interface FileMeta {
  path: string
  fileHash: string
  language: SupportedLanguage
  mtimeMs: number
  sizeBytes: number
}

export interface Chunk {
  chunkId: string
  path: string
  language: SupportedLanguage
  kind: string
  name: string
  parentName: string
  startLine: number
  endLine: number
  content: string
  fileHash: string
}

export interface Embedding {
  chunkId: string
  vector: Float32Array
}
