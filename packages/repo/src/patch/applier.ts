import { spawn } from 'node:child_process';
import isBinaryPath from 'is-binary-path';
import {
  PatchApplyResult,
  PatchError,
  PatchErrorKind,
  PatchApplyErrorDetail,
} from '@orchestrator/shared';

export interface PatchApplierOptions {
  maxFilesChanged?: number;
  maxLinesTouched?: number;
  allowBinary?: boolean;
  dryRun?: boolean;
}

export class PatchApplier {
  /**
   * Applies a unified diff to the repository.
   *
   * @param repoRoot Absolute path to the repository root.
   * @param diffText The unified diff patch text to apply.
   * @param options Configuration options for applying the patch.
   */
  async applyUnifiedDiff(
    repoRoot: string,
    diffText: string,
    options: PatchApplierOptions = {},
  ): Promise<PatchApplyResult> {
    // Some patch sources (including LLMs) include extra completely-empty lines outside hunks.
    // `git apply --recount` can misinterpret these and fail to apply otherwise-valid patches.
    const normalizedDiffText = trimCompletelyEmptyOuterLines(diffText);

    const {
      maxFilesChanged = 50,
      maxLinesTouched = 1000,
      allowBinary = false,
      dryRun = false,
    } = options;

    // 1. Validate Patch Syntax and Security
    const validationError = this.validateDiff(normalizedDiffText, {
      maxFilesChanged,
      maxLinesTouched,
      allowBinary,
    });

    if (validationError) {
      return {
        applied: false,
        filesChanged: [],
        error: validationError,
      };
    }

    // Some agents will produce "no-op" diffs (headers only) when a step is already satisfied.
    // `git apply` rejects many such patches; treat them as a successful no-op to avoid repeated failures.
    if (isNoOpDiff(normalizedDiffText)) {
      return {
        applied: true,
        filesChanged: [],
      };
    }

    // 2. Extract affected files for reporting
    const affectedFiles = this.extractAffectedFiles(normalizedDiffText);

    // 3. Apply Patch
    try {
      await this.execGitApply(repoRoot, normalizedDiffText, dryRun);
      return {
        applied: true,
        filesChanged: affectedFiles,
      };
    } catch (err: unknown) {
      const error = err as { message: string; stderr?: string };
      const parsed = this.parseGitApplyError(error.stderr || '');

      return {
        applied: false,
        filesChanged: [],
        error: {
          type: 'execution',
          message: error.message || 'Failed to apply patch',
          details: {
            stderr: error.stderr,
            kind: parsed.kind,
            errors: parsed.errors,
          },
        },
      };
    }
  }

  /**
   * Validation limits for diff operations
   */
  private interface DiffLimits {
    maxFilesChanged: number;
    maxLinesTouched: number;
    allowBinary: boolean;
  }

  /**
   * Statistics collected during diff parsing
   */
  private interface DiffStats {
    fileCount: number;
    addedLines: number;
    removedLines: number;
  }

  private validateDiff(
    diffText: string,
    limits: { maxFilesChanged: number; maxLinesTouched: number; allowBinary: boolean },
  ): PatchError | undefined {
    const lines = diffText.split('\n');
    
    // Step 1: Check for empty diff
    const emptyError = this.validateNotEmpty(diffText);
    if (emptyError) return emptyError;

    // Step 2: Validate diff structure (headers, hunks, blocks)
    const structureResult = this.validateDiffStructure(lines, limits.allowBinary);
    if (structureResult.error) return structureResult.error;

    // Step 3: Validate limits (file count, lines touched)
    const limitError = this.validateDiffLimits(structureResult.stats, limits);
    if (limitError) return limitError;

    return undefined;
  }

  /**
   * Validates that the diff is not empty
   */
  private validateNotEmpty(diffText: string): PatchError | undefined {
    if (diffText.trim().length === 0) {
      return { type: 'validation', message: 'Empty diff' };
    }
    return undefined;
  }

  /**
   * Validates diff limits (file count, lines touched)
   */
  private validateDiffLimits(
    stats: { fileCount: number; addedLines: number; removedLines: number },
    limits: { maxFilesChanged: number; maxLinesTouched: number },
  ): PatchError | undefined {
    if (stats.fileCount > limits.maxFilesChanged) {
      return {
        type: 'limit',
        message: `Too many files changed (${stats.fileCount} > ${limits.maxFilesChanged})`,
      };
    }

    const totalLinesTouched = stats.addedLines + stats.removedLines;
    if (totalLinesTouched > limits.maxLinesTouched) {
      return {
        type: 'limit',
        message: `Too many lines touched (${totalLinesTouched} > ${limits.maxLinesTouched})`,
      };
    }

    return undefined;
  }

  /**
   * Validates diff structure including headers, hunks, and file blocks.
   * Also performs security validation on file paths.
   */
  private validateDiffStructure(
    lines: string[],
    allowBinary: boolean,
  ): { error?: PatchError; stats: { fileCount: number; addedLines: number; removedLines: number } } {
    const stats = { fileCount: 0, addedLines: 0, removedLines: 0 };
    let hasAnyOldHeader = false;
    let hasAnyNewHeader = false;
    let hasAnyDiffGit = false;

    // Track whether we've seen valid file headers for the current file block.
    let currentHasOldHeader = false;
    let currentHasNewHeader = false;
    let inFileBlock = false;

    // Track each "diff --git" block to ensure it eventually contains file headers.
    let currentDiffGitStartLine: number | undefined;
    let currentDiffGitHasFileHeaders = false;

    const resetCurrentFile = () => {
      currentHasOldHeader = false;
      currentHasNewHeader = false;
      inFileBlock = false;
    };

    for (let idx = 0; idx < lines.length; idx++) {
      const line = lines[idx];
      const lineNumber = idx + 1;

      // Handle "diff --git" lines
      if (line.startsWith('diff --git')) {
        hasAnyDiffGit = true;
        const blockError = this.validatePreviousDiffGitBlock(
          currentDiffGitStartLine,
          currentDiffGitHasFileHeaders,
        );
        if (blockError) return { error: blockError, stats };
        
        currentDiffGitStartLine = lineNumber;
        currentDiffGitHasFileHeaders = false;
        resetCurrentFile();
        continue;
      }

      // Handle "--- " headers
      if (line.startsWith('--- ')) {
        hasAnyOldHeader = true;
        if (currentDiffGitStartLine !== undefined) currentDiffGitHasFileHeaders = true;
        currentHasOldHeader = true;
        currentHasNewHeader = false;
        inFileBlock = false;
        continue;
      }

      // Handle "+++ " headers
      if (line.startsWith('+++ ')) {
        hasAnyNewHeader = true;
        if (currentDiffGitStartLine !== undefined) currentDiffGitHasFileHeaders = true;
        
        if (!currentHasOldHeader) {
          return {
            error: this.makeValidationError(
              `Invalid diff: "+++ ..." header without preceding "--- ..." header (line ${lineNumber})`,
              lineNumber,
              'Ensure each file diff includes both "--- ..." and "+++ ..." headers before any "@@" hunks.',
            ),
            stats,
          };
        }

        currentHasNewHeader = true;
        inFileBlock = true;

        // Validate file path if this is a "+++ b/" header
        if (line.startsWith('+++ b/')) {
          stats.fileCount++;
          const filePath = line.substring(6).trim();
          
          const securityError = this.validateFileInDiff(filePath, allowBinary);
          if (securityError) return { error: securityError, stats };
        }

        continue;
      }

      // Handle hunk headers
      if (line.startsWith('@@ ')) {
        if (!inFileBlock || !(currentHasOldHeader && currentHasNewHeader)) {
          return {
            error: this.makeValidationError(
              `Invalid diff: hunk header found without file headers (line ${lineNumber})`,
              lineNumber,
              'Include full file headers ("diff --git", "---", "+++") before any "@@" hunk headers. Do not output patch fragments.',
            ),
            stats,
          };
        }
      }

      // Count added/removed lines
      if (line.startsWith('+') && !line.startsWith('+++')) stats.addedLines++;
      if (line.startsWith('-') && !line.startsWith('---')) stats.removedLines++;
    }

    // Final validations after processing all lines
    const finalError = this.validateFinalDiffState(
      currentHasOldHeader,
      currentHasNewHeader,
      currentDiffGitStartLine,
      currentDiffGitHasFileHeaders,
      hasAnyOldHeader,
      hasAnyNewHeader,
      hasAnyDiffGit,
    );
    if (finalError) return { error: finalError, stats };

    return { stats };
  }

  /**
   * Validates that the previous "diff --git" block had proper file headers
   */
  private validatePreviousDiffGitBlock(
    startLine: number | undefined,
    hasFileHeaders: boolean,
  ): PatchError | undefined {
    if (startLine !== undefined && !hasFileHeaders) {
      return this.makeValidationError(
        `Invalid diff: "diff --git" block missing file headers (started at line ${startLine})`,
        startLine,
        'Ensure each "diff --git" block includes both "--- ..." and "+++ ..." headers.',
      );
    }
    return undefined;
  }

  /**
   * Validates a file path within a diff for security and binary restrictions
   */
  private validateFileInDiff(filePath: string, allowBinary: boolean): PatchError | undefined {
    // Security: Comprehensive path traversal and injection detection
    const pathSecurityError = this.validatePathSecurity(filePath);
    if (pathSecurityError) {
      return { type: 'security', message: pathSecurityError };
    }

    // Security: Binary Files
    if (!allowBinary && isBinaryPath(filePath)) {
      return {
        type: 'security',
        message: `Binary file patch detected: ${filePath}`,
      };
    }

    return undefined;
  }

  /**
   * Validates the final state after processing all diff lines
   */
  private validateFinalDiffState(
    currentHasOldHeader: boolean,
    currentHasNewHeader: boolean,
    currentDiffGitStartLine: number | undefined,
    currentDiffGitHasFileHeaders: boolean,
    hasAnyOldHeader: boolean,
    hasAnyNewHeader: boolean,
    hasAnyDiffGit: boolean,
  ): PatchError | undefined {
    // Check for incomplete file header pair
    if (currentHasOldHeader && !currentHasNewHeader) {
      return this.makeValidationError(
        'Invalid diff: file header "--- ..." found without matching "+++ ..."',
        undefined,
        'Ensure every file diff contains both "--- ..." and "+++ ..." header lines.',
      );
    }

    // Check for incomplete final "diff --git" block
    if (currentDiffGitStartLine !== undefined && !currentDiffGitHasFileHeaders) {
      return this.makeValidationError(
        `Invalid diff: "diff --git" block missing file headers (started at line ${currentDiffGitStartLine})`,
        currentDiffGitStartLine,
        'Ensure each "diff --git" block includes both "--- ..." and "+++ ..." headers.',
      );
    }

    return undefined;
  }

  /**
   * Creates a validation error with consistent structure
   */
  private makeValidationError(
    message: string,
    line?: number,
    suggestion?: string,
  ): PatchError {
    return {
      type: 'validation',
      message,
      details: {
        kind: 'INVALID_PATCH',
        errors: [
          {
            kind: 'INVALID_PATCH',
            line,
            message,
            suggestion,
          },
        ],
      },
    };
  }

  /**
   * Validates a file path for security issues including:
   * - Path traversal attempts (../, encoded variants)
   * - Absolute paths
   * - Null byte injection
   * - Double encoding attacks
   * - Suspicious patterns that could indicate symlink attacks
   * 
   * @returns Error message if path is unsafe, undefined if safe
   */
  private validatePathSecurity(filePath: string): string | undefined {
    // Check for null bytes (can truncate paths in some systems)
    if (filePath.includes('\0') || filePath.includes('%00')) {
      return `Null byte injection detected in path: ${filePath}`;
    }

    // Decode the path to catch encoded traversal attempts
    // Apply multiple rounds of decoding to catch double/triple encoding
    let decodedPath = filePath;
    let previousPath = '';
    let iterations = 0;
    const maxIterations = 5; // Prevent infinite loops from malformed input
    
    while (decodedPath !== previousPath && iterations < maxIterations) {
      previousPath = decodedPath;
      try {
        decodedPath = decodeURIComponent(decodedPath);
      } catch {
        // Invalid URI encoding - could be an attack, but continue with current value
        break;
      }
      iterations++;
    }

    // Normalize backslashes to forward slashes for consistent checking
    const normalizedPath = decodedPath.replace(/\\/g, '/');

    // Check for path traversal in both original and decoded forms
    const traversalPatterns = [
      '../',           // Standard Unix traversal
      '..\\',          // Windows traversal (before normalization)
      '..',            // Just ".." could be dangerous at path boundaries
    ];

    for (const pattern of traversalPatterns) {
      if (filePath.includes(pattern) || normalizedPath.includes(pattern)) {
        return `Path traversal detected: ${filePath}`;
      }
    }

    // Check for absolute paths (Unix-style)
    if (normalizedPath.startsWith('/')) {
      return `Absolute path not allowed: ${filePath}`;
    }

    // Check for Windows absolute paths (drive letters)
    // Matches patterns like "C:", "D:\", "c:/", etc.
    if (/^[a-zA-Z]:[\\/]?/.test(normalizedPath) || /^[a-zA-Z]:[\\/]?/.test(filePath)) {
      return `Absolute Windows path not allowed: ${filePath}`;
    }

    // Check for UNC paths (Windows network paths)
    if (normalizedPath.startsWith('//') || filePath.startsWith('\\\\')) {
      return `UNC path not allowed: ${filePath}`;
    }

    // Check for suspicious device paths (Windows)
    const windowsDevices = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
    const pathParts = normalizedPath.split('/');
    for (const part of pathParts) {
      if (windowsDevices.test(part)) {
        return `Reserved Windows device name detected: ${filePath}`;
      }
    }

    // Check for paths that try to escape via encoded separators
    // %2f = /, %5c = \
    const encodedSeparatorPattern = /%(?:2f|5c)/i;
    if (encodedSeparatorPattern.test(filePath)) {
      return `Encoded path separator detected (potential traversal): ${filePath}`;
    }

    return undefined;
  }

  private extractAffectedFiles(diffText: string): string[] {
    const files: string[] = [];
    const lines = diffText.split('\n');
    for (const line of lines) {
      if (line.startsWith('+++ b/')) {
        files.push(line.substring(6).trim());
      }
    }
    return files;
  }

  private execGitApply(repoRoot: string, diffText: string, dryRun: boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      const baseArgs = [
        'apply',
        '--whitespace=nowarn',
        '--ignore-space-change',
        '--ignore-whitespace',
      ];

      const maybeCheckArg = dryRun ? ['--check'] : [];

      const tryApply = async (args: string[], patch: string): Promise<void> => {
        const fullArgs = [...baseArgs, ...args, ...maybeCheckArg, '-'];

        const git = spawn('git', fullArgs, {
          cwd: repoRoot,
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        let stderr = '';

        if (git.stdin) {
          git.stdin.write(patch);
          git.stdin.end();
        }

        git.stderr?.on('data', (data) => {
          stderr += data.toString();
        });

        const result = await new Promise<{ code: number | null; stderr: string }>((res, rej) => {
          git.on('close', (code) => res({ code, stderr }));
          git.on('error', (err) => rej(err));
        });

        if (result.code === 0) return;

        throw { message: `git apply failed with code ${result.code ?? -1}`, stderr: result.stderr };
      };

      (async () => {
        try {
          // First try: standard apply. This is the most compatible with "git diff"-style output,
          // including blank separator lines between file diffs.
          await tryApply([], diffText);
          resolve();
        } catch (err: unknown) {
          const error = err as { message: string; stderr?: string };
          const stderr = error.stderr || '';

          // LLM-generated diffs frequently have incorrect hunk line counts, which `git apply`
          // reports as "corrupt patch". As a fallback, retry with `--recount` after removing
          // blank separator lines (which can confuse `--recount` parsing).
          if (stderr.includes('corrupt patch at line')) {
            try {
              await tryApply(['--recount'], stripCompletelyEmptyLines(diffText));
              resolve();
              return;
            } catch (recountErr: unknown) {
              const recountError = recountErr as { message: string; stderr?: string };
              reject({
                message: recountError.message || error.message,
                stderr: recountError.stderr || stderr,
              });
              return;
            }
          }

          reject({ message: error.message || 'git apply failed', stderr });
        }
      })().catch((e) => {
        const err = e as Error;
        reject({ message: `Failed to spawn git: ${err.message}` });
      });
    });
  }

  private parseGitApplyError(stderr: string): {
    kind: PatchErrorKind;
    errors: PatchApplyErrorDetail[];
  } {
    const lines = stderr.split('\n');
    const errors: PatchApplyErrorDetail[] = [];
    let overallKind: PatchErrorKind = 'UNKNOWN';

    for (const line of lines) {
      // Malformed patch: "patch fragment without header"
      const fragmentMatch = line.match(/^error: patch fragment without header at line (\d+)(?::\s*(.*))?/);
      if (fragmentMatch) {
        const lineNo = parseInt(fragmentMatch[1] || '0', 10);
        const fragment = fragmentMatch[2]?.trim();
        errors.push({
          kind: 'INVALID_PATCH',
          line: Number.isFinite(lineNo) && lineNo > 0 ? lineNo : undefined,
          message: fragment
            ? `Patch fragment without header: ${fragment}`
            : 'Patch fragment without header',
          suggestion:
            'Ensure each file diff includes headers ("diff --git", "---", "+++") before any "@@" hunks. Do not output patch fragments.',
        });
        if (overallKind === 'UNKNOWN') overallKind = 'INVALID_PATCH';
        continue;
      }

      // Malformed patch: "corrupt patch at line"
      const corruptMatch = line.match(/^error: corrupt patch at line (\d+)/);
      if (corruptMatch) {
        const lineNo = parseInt(corruptMatch[1] || '0', 10);
        errors.push({
          kind: 'CORRUPT_PATCH',
          line: Number.isFinite(lineNo) && lineNo > 0 ? lineNo : undefined,
          message: `Corrupt patch at line ${corruptMatch[1]}`,
          suggestion:
            'Hunk line counts may be incorrect. Regenerate the diff with correct @@ ranges, or regenerate based on the current file content.',
        });
        if (overallKind === 'UNKNOWN') overallKind = 'CORRUPT_PATCH';
        continue;
      }

      // Hunk Failed: error: patch failed: test.txt:1
      const hunkMatch = line.match(/^error: patch failed: (.+):(\d+)/);
      if (hunkMatch) {
        errors.push({
          kind: 'HUNK_FAILED',
          file: hunkMatch[1],
          line: parseInt(hunkMatch[2], 10),
          message: `Hunk failed at line ${hunkMatch[2]}`,
          suggestion:
            'The file has changed since the patch was created. Try regenerating the patch with updated context.',
        });
        if (overallKind === 'UNKNOWN') overallKind = 'HUNK_FAILED';
        continue;
      }

      // File Not Found: error: <file>: No such file or directory
      const fileNotFoundMatch = line.match(/^error: (.+): No such file or directory/);
      if (fileNotFoundMatch) {
        errors.push({
          kind: 'FILE_NOT_FOUND',
          file: fileNotFoundMatch[1],
          message: 'File not found',
          suggestion:
            'Ensure the file exists before applying the patch, or check if the patch should create the file.',
        });
        if (overallKind === 'UNKNOWN') overallKind = 'FILE_NOT_FOUND';
        continue;
      }

      // Already Exists: error: <file>: already exists
      const existsMatch = line.match(/^error: (.+): already exists/);
      if (existsMatch) {
        errors.push({
          kind: 'ALREADY_EXISTS',
          file: existsMatch[1],
          message: 'File already exists',
          suggestion:
            'The patch attempts to create a file that already exists. Remove the file or update the patch.',
        });
        if (overallKind === 'UNKNOWN') overallKind = 'ALREADY_EXISTS';
        continue;
      }

      // Whitespace
      if (line.includes('whitespace error')) {
        if (overallKind === 'UNKNOWN') overallKind = 'WHITESPACE';
      }
    }

    return { kind: overallKind, errors };
  }
}

function trimCompletelyEmptyOuterLines(raw: string): string {
  // Remove completely empty leading/trailing lines (no characters at all),
  // but preserve lines with spaces (which can be meaningful diff context).
  const lines = raw.split('\n');
  const firstContentIdx = lines.findIndex((l) => l !== '');
  if (firstContentIdx === -1) return '';

  let lastContentIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i] !== '') {
      lastContentIdx = i;
      break;
    }
  }

  // `git apply --recount` requires a final newline; add exactly one.
  return lines.slice(firstContentIdx, lastContentIdx + 1).join('\n') + '\n';
}

function stripCompletelyEmptyLines(raw: string): string {
  // `git apply --recount` is sensitive to blank separator lines between file diffs.
  // Remove lines that are exactly empty, but keep whitespace-only lines (which can be meaningful).
  const lines = raw.split('\n').filter((line) => line !== '');
  if (lines.length === 0) return '';
  return lines.join('\n') + '\n';
}

function isNoOpDiff(diffText: string): boolean {
  const lines = diffText.split('\n');

  const hasOldHeader = lines.some((l) => l.startsWith('--- '));
  const hasNewHeader = lines.some((l) => l.startsWith('+++ '));
  if (!(hasOldHeader && hasNewHeader)) return false;

  // If there are any hunks or real +/- lines, it's not a no-op.
  for (const line of lines) {
    if (line.startsWith('@@ ')) return false;
    if (line.startsWith('+') && !line.startsWith('+++')) return false;
    if (line.startsWith('-') && !line.startsWith('---')) return false;
  }

  return true;
}
