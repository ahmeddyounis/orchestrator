import { spawn } from 'node:child_process';
import isBinaryPath from 'is-binary-path';
import { PatchApplyResult, PatchError } from '@orchestrator/shared';

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
      return {
        applied: false,
        filesChanged: [],
        error: {
          type: 'execution',
          message: error.message || 'Failed to apply patch',
          details: { stderr: error.stderr },
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
      const args = ['apply', '--whitespace=nowarn'];
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
}
