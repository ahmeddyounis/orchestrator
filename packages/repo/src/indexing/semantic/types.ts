export interface SemanticChunk {
  chunkId: string;
  path: string;
  language: string;
  kind: 'function' | 'class' | 'method' | 'interface' | 'type' | 'export' | 'const' | 'unknown';
  name: string;
  startLine: number;
  endLine: number;
  content: string;
  parentName?: string;
  fileHash: string;
}

export interface FileInput {
  path: string;
  content: string;
  language: string;
  fileHash: string;
}
