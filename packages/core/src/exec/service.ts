import { GitService, PatchApplier, PatchApplierOptions } from '@orchestrator/repo';
import { Config } from '@orchestrator/shared';
import { EventBus } from '../registry';

export interface ConfirmationProvider {
  confirm(message: string, details?: string, defaultNo?: boolean): Promise<boolean>;
}

export interface ApplyResult {
  success: boolean;
  error?: string;
  filesChanged?: string[];
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

      // 2. Try applying with limits
      let result = await this.applier.applyUnifiedDiff(this.repoRoot, patchText, patchOptions);

      // 3. Handle Limit Exceeded -> Confirmation
      if (!result.applied && result.error?.type === 'limit') {
        if (this.confirmationProvider) {
          const confirmed = await this.confirmationProvider.confirm(
            'Patch exceeds configured limits. Apply anyway?',
            result.error.message,
            true, // Default to No
          );

          if (confirmed) {
            // Retry with unlimited
            result = await this.applier.applyUnifiedDiff(this.repoRoot, patchText, {
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
        const errorMsg = result.error?.message || 'Unknown error';
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

        return { success: false, error: errorMsg };
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
