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
    const {
      maxFilesChanged = 50,
      maxLinesTouched = 1000,
      allowBinary = false,
      dryRun = false,
    } = options;

    // 1. Validate Patch Syntax and Security
    const validationError = this.validateDiff(diffText, {
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

    // 2. Extract affected files for reporting
    const affectedFiles = this.extractAffectedFiles(diffText);

    // 3. Apply Patch
    try {
      await this.execGitApply(repoRoot, diffText, dryRun);
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

  private validateDiff(
    diffText: string,
    limits: { maxFilesChanged: number; maxLinesTouched: number; allowBinary: boolean },
  ): PatchError | undefined {
    const lines = diffText.split('\n');
    let fileCount = 0;
    let addedLines = 0;
    let removedLines = 0;

    for (const line of lines) {
      if (line.startsWith('+++ b/')) {
        fileCount++;
        const filePath = line.substring(6).trim();

        // Security: Path Traversal
        if (filePath.includes('../') || filePath.includes('..\\')) {
          return {
            type: 'security',
            message: `Path traversal detected: ${filePath}`,
          };
        }

        // Security: Binary Files
        if (!limits.allowBinary && isBinaryPath(filePath)) {
          return {
            type: 'security',
            message: `Binary file patch detected: ${filePath}`,
          };
        }
      }

      // Check for LOC limits
      if (line.startsWith('+') && !line.startsWith('+++')) addedLines++;
      if (line.startsWith('-') && !line.startsWith('---')) removedLines++;
    }

    // Validate limits
    if (fileCount > limits.maxFilesChanged) {
      return {
        type: 'limit',
        message: `Too many files changed (${fileCount} > ${limits.maxFilesChanged})`,
      };
    }

    const totalLinesTouched = addedLines + removedLines;
    if (totalLinesTouched > limits.maxLinesTouched) {
      return {
        type: 'limit',
        message: `Too many lines touched (${totalLinesTouched} > ${limits.maxLinesTouched})`,
      };
    }

    // Basic syntax check: must have at least one file header or valid hunk
    // This is loose, as 'git apply' does stricter validation, but we want to catch garbage early.
    if (fileCount === 0 && !diffText.includes('diff --git')) {
      // Some diffs might rely on 'diff --git' but usually standard unified diffs have +++ and ---
      // If it's a completely empty diff or garbage string
      if (diffText.trim().length === 0) {
        return { type: 'validation', message: 'Empty diff' };
      }
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
      const args = ['apply', '--whitespace=nowarn', '--ignore-space-change', '--ignore-whitespace'];
      if (dryRun) {
        args.push('--check'); // --check is effectively a dry-run for apply
      }

      // Use - to read from stdin
      args.push('-');

      const git = spawn('git', args, {
        cwd: repoRoot,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stderr = '';

      if (git.stdin) {
        git.stdin.write(diffText);
        git.stdin.end();
      }

      git.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      git.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject({ message: `git apply failed with code ${code}`, stderr });
        }
      });

      git.on('error', (err) => {
        reject({ message: `Failed to spawn git: ${err.message}`, stderr });
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
