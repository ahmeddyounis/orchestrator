/**
 * Type of patch format used for code modifications.
 */
export type PatchType = 'unified-diff' | 'file-edit';

/**
 * A patch in unified diff format (git-compatible).
 */
export interface UnifiedDiffPatch {
  /** Discriminator for patch type */
  kind: 'unified-diff';
  /** The unified diff text content */
  diffText: string;
}

/**
 * A single edit operation within a file.
 */
export interface FileEditOperation {
  /** Type of edit operation */
  type: 'replace' | 'insert' | 'delete';
  /** Starting line number (1-indexed) */
  startLine: number;
  /** Ending line number for replace/delete operations */
  endLine?: number;
  /** New content for replace/insert operations */
  content?: string;
}

/**
 * A patch using structured file edit operations.
 */
export interface FileEditPatch {
  /** Discriminator for patch type */
  kind: 'file-edit';
  /** List of files and their edit operations */
  edits: Array<{
    /** Relative path to the file */
    path: string;
    /** Operations to apply to the file */
    operations: FileEditOperation[];
  }>;
}

/**
 * A patch candidate that can be applied to the codebase.
 */
export type PatchCandidate = UnifiedDiffPatch | FileEditPatch;

/**
 * Classification of patch application errors.
 */
export type PatchErrorKind =
  | 'HUNK_FAILED'
  | 'FILE_NOT_FOUND'
  | 'ALREADY_EXISTS'
  | 'INVALID_PATCH'
  | 'CORRUPT_PATCH'
  | 'WHITESPACE'
  | 'UNKNOWN';

/**
 * Detailed information about a patch application error.
 */
export interface PatchApplyErrorDetail {
  /** File where the error occurred */
  file?: string;
  /** Line number where the error occurred */
  line?: number;
  /** Type of error */
  kind: PatchErrorKind;
  /** Human-readable error message */
  message: string;
  /** Suggested fix for the error */
  suggestion?: string;
}

/**
 * Error information from a failed patch operation.
 */
export interface PatchError {
  /** Category of the error */
  type: 'validation' | 'security' | 'execution' | 'limit';
  /** Human-readable error message */
  message: string;
  /** Additional error details */
  details?:
    | {
        kind?: PatchErrorKind;
        errors?: PatchApplyErrorDetail[];
        stderr?: string;
        [key: string]: unknown;
      }
    | unknown;
}

/**
 * Result of applying a patch to the codebase.
 */
export interface PatchApplyResult {
  /** Whether the patch was successfully applied */
  applied: boolean;
  /** List of files that were modified */
  filesChanged: string[];
  /** Error information if the patch failed */
  error?: PatchError;
}
