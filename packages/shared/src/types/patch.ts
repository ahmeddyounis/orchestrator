export type PatchType = 'unified-diff' | 'file-edit';

export interface UnifiedDiffPatch {
  kind: 'unified-diff';
  diffText: string;
}

export interface FileEditOperation {
  type: 'replace' | 'insert' | 'delete';
  startLine: number;
  endLine?: number;
  content?: string;
}

export interface FileEditPatch {
  kind: 'file-edit';
  edits: Array<{
    path: string;
    operations: FileEditOperation[];
  }>;
}

export type PatchCandidate = UnifiedDiffPatch | FileEditPatch;

export interface PatchError {
  type: 'validation' | 'security' | 'execution' | 'limit';
  message: string;
  details?: unknown;
}

export interface PatchApplyResult {
  applied: boolean;
  filesChanged: string[];
  error?: PatchError;
}