import { Command } from 'commander';
import path from 'node:path';
import { statSync } from 'node:fs';
import {
  findRepoRoot,
  IndexUpdater,
  SemanticIndexUpdater,
  emitter,
  loadIndex,
  type Index,
} from '@orchestrator/repo';
import { ConfigLoader, reconcileMemoryStaleness, type DeepPartial } from '@orchestrator/core';
import { createMemoryStore } from '@orchestrator/memory';
import type { Config } from '@orchestrator/shared';
import { GlobalOptions } from '../../types';
import { createEmbedder } from '@orchestrator/adapters';

export function registerIndexUpdateCommand(parent: Command) {
  parent
    .command('update')
    .description('Update an existing repository index')
    .option('--semantic', 'Enable semantic indexing', false)
    .option('--semantic-embedder <provider>', 'Specify semantic embedding provider')
    .action(async (options, command: Command) => {
      let program = command.parent;
      while (program?.parent) {
        program = program.parent;
      }
      const globalOpts = program!.opts() as GlobalOptions;

      const repoRoot = await findRepoRoot();
      const repoId = repoRoot;

      const flags: DeepPartial<Config> = {};
      if (options.semantic) {
        flags.indexing = { semantic: { enabled: true } };
      }
      if (options.semanticEmbedder) {
        flags.indexing = {
          ...flags.indexing,
          semantic: {
            ...(flags.indexing?.semantic ?? {}),
            embeddings: {
              provider: options.semanticEmbedder,
            },
          },
        };
      }

      const config = ConfigLoader.load({
        configPath: globalOpts.config,
        cwd: repoRoot,
        flags,
      });

      const indexRelPath = config.indexing?.path ?? '.orchestrator/index/index.json';
      const indexPath = path.isAbsolute(indexRelPath)
        ? indexRelPath
        : path.join(repoRoot, indexRelPath);
      const updater = new IndexUpdater(indexPath);

      const startTime = Date.now();
      const report = await updater.update(repoRoot);
      const durationMs = Date.now() - startTime;

      let markedStaleCount = 0;
      let clearedStaleCount = 0;

      if (config.memory.enabled) {
        const dbPath = path.isAbsolute(config.memory.storage.path)
          ? config.memory.storage.path
          : path.join(repoRoot, config.memory.storage.path);
        try {
          statSync(dbPath);
          const memoryStore = createMemoryStore();
          const keyEnvVar = config.security?.encryption?.keyEnv ?? 'ORCHESTRATOR_ENC_KEY';
          const key = process.env[keyEnvVar] ?? '';
          memoryStore.init({
            dbPath,
            encryption: {
              encryptAtRest: config.memory.storage.encryptAtRest ?? false,
              key,
            },
          });

          const updatedIndex = loadIndex(indexPath) as unknown as Index | null;
          if (updatedIndex) {
            const stalenessResult = await reconcileMemoryStaleness(
              repoId,
              updatedIndex,
              memoryStore,
            );
            markedStaleCount = stalenessResult.markedStaleCount;
            clearedStaleCount = stalenessResult.clearedStaleCount;
          }
          memoryStore.close();
        } catch {
          // DB file doesn't exist or is unreadable, so skip reconciliation
        }
      }

      type SemanticUpdateResult = {
        repoId: string;
        changedFiles: number;
        removedFiles: number;
        durationMs: number;
      };

      let semanticResult: SemanticUpdateResult | undefined;
      const semanticConfig = config.indexing?.semantic;
      if (options.semantic || semanticConfig?.enabled) {
        if (!semanticConfig) {
          throw new Error('Semantic indexing is enabled, but no semantic config is present.');
        }

        const finishPromise = new Promise<SemanticUpdateResult>((resolve) => {
          emitter.once('semanticIndexUpdateFinished', (event) => {
            resolve(event as SemanticUpdateResult);
          });
        });

        const embedder = createEmbedder(semanticConfig.embeddings);
        const semanticUpdater = new SemanticIndexUpdater();
        await semanticUpdater.update({
          repoId,
          repoRoot,
          embedder,
          maxFileSizeBytes: config.indexing?.maxFileSizeBytes,
        });
        semanticResult = await finishPromise;
      }

      if (globalOpts.json) {
        const output: Record<string, unknown> = {
          report,
          reconciliation: {
            markedStale: markedStaleCount,
            clearedStale: clearedStaleCount,
          },
        };
        if (semanticResult) {
          output.semanticResult = semanticResult;
        }
        console.log(JSON.stringify(output, null, 2));
        return;
      }

      console.log(`Successfully updated index at: ${indexPath}`);
      console.log(`- Took ${durationMs}ms`);
      console.log(
        `- ${report.added.length} added, ${report.changed.length} changed, ${report.removed.length} removed (rehashed: ${report.rehashedCount})`,
      );

      if (config.memory.enabled) {
        console.log(
          `- Reconciled memory: ${markedStaleCount} marked stale, ${clearedStaleCount} cleared stale`,
        );
      }

      if (semanticResult) {
        console.log(`\nSemantic index updated successfully.`);
        console.log(`  - Changed files: ${semanticResult.changedFiles}`);
        console.log(`  - Removed files: ${semanticResult.removedFiles}`);
        console.log(`  - Took ${semanticResult.durationMs}ms`);
      }
    });
}
