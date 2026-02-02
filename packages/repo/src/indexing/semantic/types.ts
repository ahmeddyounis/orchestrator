import type { SupportedLanguage } from '../../tree-sitter';

export type SemanticKind =
  | 'function'
  | 'class'
  | 'method'
  | 'interface'
  | 'type'
  | 'export'
  | 'const'
  | 'unknown';

export interface SemanticChunk {
  chunkId: string;
  path: string;
  language: SupportedLanguage;
  kind: SemanticKind;
  name: string;
  startLine: number;
  endLine: number;
  content: string;
  parentName: string | null;
  fileHash: string;
}

export interface FileInput {
  path: string;
  content: string;
  language: SupportedLanguage;
  fileHash: string;
}
