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
export type PatchErrorKind = 'HUNK_FAILED' | 'FILE_NOT_FOUND' | 'ALREADY_EXISTS' | 'WHITESPACE' | 'UNKNOWN';
export interface PatchApplyErrorDetail {
    file?: string;
    line?: number;
    kind: PatchErrorKind;
    message: string;
    suggestion?: string;
}
export interface PatchError {
    type: 'validation' | 'security' | 'execution' | 'limit';
    message: string;
    details?: {
        kind?: PatchErrorKind;
        errors?: PatchApplyErrorDetail[];
        stderr?: string;
        [key: string]: unknown;
    } | unknown;
}
export interface PatchApplyResult {
    applied: boolean;
    filesChanged: string[];
    error?: PatchError;
}
//# sourceMappingURL=patch.d.ts.map