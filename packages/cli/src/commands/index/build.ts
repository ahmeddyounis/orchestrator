import { Command } from 'commander';
import { IndexBuilder, findRepoRoot } from '@orchestrator/repo';
import {
  ConfigLoader,
  reconcileMemoryStaleness,
} from '@orchestrator/core';
import { createMemoryStore } from '@orchestrator/memory';
import { OrchestratorEvent } from '@orchestrator/shared';
import { GlobalOptions } from '../../types';
import { statSync } from 'node:fs';
import { createHash } from 'node:crypto';

export function registerIndexBuildCommand(parent: Command) {
  parent
    .command('build')
    .description('Build a new repository index from scratch')
    .action(async (_options, command: Command) => {
      let program = command.parent;
      while (program?.parent) {
        program = program.parent;
      }
      const globalOpts = program!.opts() as GlobalOptions;

      const events: OrchestratorEvent[] = [];
      const eventBus = {
        emit: async (event: OrchestratorEvent) => {
          events.push(event);
        },
      };

      const repoRoot = await findRepoRoot();
      const repoId = createHash('sha256').update(repoRoot).digest('hex');

      const config = ConfigLoader.load({
        configPath: globalOpts.config,
        flags: {},
      });

      const builder = new IndexBuilder({
        maxFileSizeBytes:
          config.indexing?.maxFileSizeBytes ?? 2 * 1024 * 1024,
      });

      const startTime = Date.now();
      const runId = startTime.toString();
      const index = await builder.build(repoRoot);
      const durationMs = Date.now() - startTime;

      let markedStaleCount = 0;
      let clearedStaleCount = 0;

      if (config.memory.enabled) {
        const dbPath = config.memory.storage.path;
        try {
          statSync(dbPath);
          const memoryStore = createMemoryStore();
          memoryStore.init(dbPath);
          const stalenessResult = await reconcileMemoryStaleness(
            repoId,
            index,
            memoryStore,
          );
          markedStaleCount = stalenessResult.markedStaleCount;
          clearedStaleCount = stalenessResult.clearedStaleCount;
          memoryStore.close();

          await eventBus.emit({
            type: 'MemoryStalenessReconciled',
            schemaVersion: 1,
            runId,
            timestamp: new Date().toISOString(),
            payload: {
              markedStale: markedStaleCount,
              clearedStale: clearedStaleCount,
            },
          });
        } catch {
          // DB file doesn't exist, so skip reconciliation
        }
      }

      if (globalOpts.json) {
        const output = {
          index,
          reconciliation: {
            markedStale: markedStaleCount,
            clearedStale: clearedStaleCount,
          },
          events,
        };
        console.log(JSON.stringify(output, null, 2));
      } else {
        console.log(
          `Successfully built index at: ${repoRoot}/.orchestrator/index`,
        );
        console.log(`- Took ${durationMs}ms`);
        console.log(`- Indexed ${index.stats.fileCount} files`);
        console.log(`- Hashed ${index.stats.hashedCount} files`);
        if (config.memory.enabled) {
          console.log(
            `- Reconciled memory: ${markedStaleCount} marked stale, ${clearedStaleCount} cleared stale`,
          );
        }
      }
    });
}


