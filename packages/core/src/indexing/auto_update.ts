import { getIndexStatus, IndexUpdater } from '@orchestrator/repo';
import type { Config, EventBus } from '@orchestrator/shared';
import path from 'path';

export interface IndexAutoUpdateServiceOptions {
  config: Config;
  repoRoot: string;
}

export interface IndexAutoUpdateContext {
  eventBus: EventBus;
  runId: string;
}

export class IndexAutoUpdateService {
  constructor(private readonly options: IndexAutoUpdateServiceOptions) {}

  async maybeAutoUpdateIndex(ctx: IndexAutoUpdateContext): Promise<void> {
    const cfg = this.options.config.indexing;
    if (!this.options.config.memory?.enabled || !cfg?.enabled || !cfg.autoUpdateOnRun) {
      return;
    }

    try {
      const orchestratorConfig = {
        ...this.options.config,
        rootDir: this.options.repoRoot,
        orchestratorDir: path.join(this.options.repoRoot, '.orchestrator'),
      };
      const status = await getIndexStatus(orchestratorConfig);

      if (!status.isIndexed) {
        // Non-fatal: indexing not yet set up.
        console.warn('Auto-update skipped: index does not exist.');
        return;
      }

      const drift = status.drift;
      if (!drift || !drift.hasDrift) {
        return; // No drift
      }

      const totalDrift = drift.addedCount + drift.removedCount + drift.changedCount;
      if (totalDrift > (cfg.maxAutoUpdateFiles ?? 5000)) {
        console.warn(
          `Index drift (${totalDrift} files) exceeds limit (${cfg.maxAutoUpdateFiles}). Skipping auto-update.`,
        );
        return;
      }

      await ctx.eventBus.emit({
        type: 'IndexAutoUpdateStarted',
        schemaVersion: 1,
        runId: ctx.runId,
        timestamp: new Date().toISOString(),
        payload: {
          fileCount: totalDrift,
          reason: 'Pre-run check detected drift.',
        },
      });

      const indexPath = path.isAbsolute(cfg.path)
        ? cfg.path
        : path.join(this.options.repoRoot, cfg.path);
      const updater = new IndexUpdater(indexPath);
      const result = await updater.update(this.options.repoRoot);

      await ctx.eventBus.emit({
        type: 'IndexAutoUpdateFinished',
        schemaVersion: 1,
        runId: ctx.runId,
        timestamp: new Date().toISOString(),
        payload: {
          filesAdded: result.added.length,
          filesRemoved: result.removed.length,
          filesChanged: result.changed.length,
        },
      });

      await ctx.eventBus.emit({
        type: 'MemoryStalenessReconciled',
        schemaVersion: 1,
        runId: ctx.runId,
        timestamp: new Date().toISOString(),
        payload: {
          details: 'Index updated, subsequent memory retrievals will use fresh data.',
        },
      });
    } catch (error) {
      console.warn('Auto-update of index failed:', error);
      // Non-fatal
    }
  }
}
