import { GitService, PatchApplier } from '@orchestrator/repo';
import { EventBus } from '../registry';

export class ExecutionService {
  constructor(
    private eventBus: EventBus,
    private git: GitService,
    private applier: PatchApplier,
    private runId: string,
    private repoRoot: string,
  ) {}

  async applyPatch(patchText: string, description: string): Promise<boolean> {
    try {
      // Apply the patch
      const result = await this.applier.applyUnifiedDiff(this.repoRoot, patchText);

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

        return true;
      } else {
        // Application Failed
        await this.eventBus.emit({
          type: 'PatchApplyFailed',
          schemaVersion: 1,
          timestamp: new Date().toISOString(),
          runId: this.runId,
          payload: {
            error: result.error?.message || 'Unknown error',
            details: result.error?.details,
          },
        });

        // Rollback (even if apply failed, git apply might have left mess if not atomic,
        // though our Applier usually handles it. But safer to rollback to last good state if we have one?
        // Actually, if apply failed, it usually doesn't change anything or cleans up.
        // But the spec says: "On PatchApplyFailed ... rollback to last checkpoint."

        // We need to know the LAST checkpoint.
        // However, createCheckpoint returns a Ref.
        // We should probably store the 'current' checkpoint somewhere?
        // Or create a checkpoint BEFORE trying to apply?

        // Spec says: "After each successfully applied patch ... create a checkpoint."
        // "On PatchApplyFailed ... rollback to last checkpoint."

        // This implies we rely on the state being clean *before* we tried.
        // If we simply rely on git, we can just "reset --hard HEAD" if we assume HEAD was the last checkpoint.
        // But if `createCheckpoint` makes a commit, then HEAD is the checkpoint.

        // If `applyUnifiedDiff` fails, does it leave the repo dirty?
        // `PatchApplier` seems to try to be atomic or use a temp dir?
        // Let's check `PatchApplier` logic again.

        // In any case, explicit rollback to HEAD is safe.
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

        return false;
      }
    } catch (err) {
      // Unexpected error
      await this.eventBus.emit({
        type: 'PatchApplyFailed',
        schemaVersion: 1,
        timestamp: new Date().toISOString(),
        runId: this.runId,
        payload: {
          error: (err as Error).message,
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

      return false;
    }
  }
}
