import { GitService, PatchApplier, PatchApplierOptions } from '@orchestrator/repo';
import { Config, PatchError } from '@orchestrator/shared';
import { EventBus } from '../registry';
import { tryRepairUnifiedDiff } from './diff_repair';

export interface ConfirmationProvider {
  confirm(message: string, details?: string, defaultNo?: boolean): Promise<boolean>;
}

export interface ApplyResult {
  success: boolean;
  error?: string;
  filesChanged?: string[];
  patchError?: PatchError;
}

export class ExecutionService {
  constructor(
    private eventBus: EventBus,
    private git: GitService,
    private applier: PatchApplier,
    private runId: string,
    private repoRoot: string,
    private config?: Config,
    private confirmationProvider?: ConfirmationProvider,
  ) {}

  async applyPatch(patchText: string, description: string): Promise<ApplyResult> {
    try {
      // 1. Prepare options from config
      const patchOptions: PatchApplierOptions = {
        maxFilesChanged: this.config?.patch?.maxFilesChanged,
        maxLinesTouched: this.config?.patch?.maxLinesChanged,
        allowBinary: this.config?.patch?.allowBinary,
      };

      // 2. Ensure patch has trailing newline (required by git apply)
      let patchTextWithNewline = patchText.endsWith('\n') ? patchText : patchText + '\n';

      // 3. Best-effort repair for common malformed diff fragments.
      const autoRepairEnabled = this.config?.execution?.autoRepairPatchFragments ?? true;
      if (autoRepairEnabled) {
        const repaired = tryRepairUnifiedDiff(patchTextWithNewline, {
          repoRoot: this.repoRoot,
          stepHint: description,
        });
        if (repaired && repaired.diffText.trim() !== patchTextWithNewline.trim()) {
          patchTextWithNewline = repaired.diffText.endsWith('\n')
            ? repaired.diffText
            : repaired.diffText + '\n';
        }
      }

      // 4. Try applying with limits
      let result = await this.applier.applyUnifiedDiff(
        this.repoRoot,
        patchTextWithNewline,
        patchOptions,
      );

      // 5. Handle Limit Exceeded -> Confirmation
      if (!result.applied && result.error?.type === 'limit') {
        if (this.confirmationProvider) {
          const confirmed = await this.confirmationProvider.confirm(
            'Patch exceeds configured limits. Apply anyway?',
            result.error.message,
            true, // Default to No
          );

          if (confirmed) {
            // Retry with unlimited
            result = await this.applier.applyUnifiedDiff(this.repoRoot, patchTextWithNewline, {
              ...patchOptions,
              maxFilesChanged: Infinity,
              maxLinesTouched: Infinity,
            });
          } else {
            // User denied
            const msg = 'Patch rejected by user (limit exceeded)';
            await this.eventBus.emit({
              type: 'PatchApplyFailed',
              schemaVersion: 1,
              timestamp: new Date().toISOString(),
              runId: this.runId,
              payload: {
                error: msg,
                details: result.error,
              },
            });
            return { success: false, error: msg };
          }
        }
      }

      if (result.applied) {
        // Success!
        await this.eventBus.emit({
          type: 'PatchApplied',
          schemaVersion: 1,
          timestamp: new Date().toISOString(),
          runId: this.runId,
          payload: {
            description,
            filesChanged: result.filesChanged,
            success: true,
          },
        });

        // Create Checkpoint
        if (!this.config?.execution?.noCheckpoints) {
          const checkpointRef = await this.git.createCheckpoint(`After: ${description}`);

          await this.eventBus.emit({
            type: 'CheckpointCreated',
            schemaVersion: 1,
            timestamp: new Date().toISOString(),
            runId: this.runId,
            payload: {
              checkpointRef,
              label: description,
            },
          });
        }

        return { success: true, filesChanged: result.filesChanged };
      } else {
        // Application Failed
        const errorMsg = formatPatchApplyError(result.error) || 'Unknown error';
        await this.eventBus.emit({
          type: 'PatchApplyFailed',
          schemaVersion: 1,
          timestamp: new Date().toISOString(),
          runId: this.runId,
          payload: {
            error: errorMsg,
            details: result.error?.details,
          },
        });

        // Rollback to HEAD
        await this.git.rollbackToCheckpoint('HEAD');

        await this.eventBus.emit({
          type: 'RollbackPerformed',
          schemaVersion: 1,
          timestamp: new Date().toISOString(),
          runId: this.runId,
          payload: {
            reason: 'Patch application failed',
            targetRef: 'HEAD',
          },
        });

        return { success: false, error: errorMsg, patchError: result.error };
      }
    } catch (err) {
      // Unexpected error
      const errorMsg = (err as Error).message;
      await this.eventBus.emit({
        type: 'PatchApplyFailed',
        schemaVersion: 1,
        timestamp: new Date().toISOString(),
        runId: this.runId,
        payload: {
          error: errorMsg,
        },
      });

      await this.git.rollbackToCheckpoint('HEAD');

      await this.eventBus.emit({
        type: 'RollbackPerformed',
        schemaVersion: 1,
        timestamp: new Date().toISOString(),
        runId: this.runId,
        payload: {
          reason: 'Unexpected error during patch',
          targetRef: 'HEAD',
        },
      });

      return { success: false, error: errorMsg };
    }
  }
}

function formatPatchApplyError(error: { message: string; details?: unknown } | undefined): string {
  if (!error) return '';

  const base = error.message || '';
  const stderr = (error.details as { stderr?: unknown } | undefined)?.stderr;

  if (typeof stderr !== 'string' || stderr.trim().length === 0) {
    return base;
  }

  // Keep the error short so it can be safely embedded in retry prompts.
  const tailLines = stderr
    .trim()
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .slice(-10)
    .join('\n');

  const maxChars = 1000;
  const excerpt = tailLines.length > maxChars ? tailLines.slice(-maxChars) : tailLines;

  return `${base}\n${excerpt}`.trim();
}
