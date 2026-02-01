import { Command } from 'commander';
import { IndexBuilder, findRepoRoot, SemanticIndexBuilder } from '@orchestrator/repo';
import { ConfigLoader, reconcileMemoryStaleness, emitter } from '@orchestrator/core';
import { createMemoryStore } from '@orchestrator/memory';
import {
  OrchestratorEvent,
  SemanticIndexBuildFinishedEvent,
  SemanticIndexingConfig,
} from '@orchestrator/shared';
import { GlobalOptions } from '../../types';
import { statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createEmbedder } from '@orchestrator/adapters';

export function registerIndexBuildCommand(parent: Command) {
  parent
    .command('build')
    .description('Build a new repository index from scratch')
    .option('--semantic', 'Enable semantic indexing', false)
    .option('--semantic-embedder <provider>', 'Specify semantic embedding provider')
    .action(async (options, command: Command) => {
      let program = command.parent;
      while (program?.parent) {
        program = program.parent;
      }
      const globalOpts = program!.opts() as GlobalOptions;

      const events: OrchestratorEvent[] = [];
      emitter.on('*', (type, event) => {
        events.push(event as OrchestratorEvent);
      });

      const repoRoot = await findRepoRoot();
      const repoId = createHash('sha256').update(repoRoot).digest('hex');

      const flags: Record<string, unknown> = {};
      if (options.semantic) {
        flags.indexing = { semantic: { enabled: true } };
      }
      if (options.semanticEmbedder) {
        flags.indexing = {
          ...flags.indexing,
          semantic: {
            // @ts-expect-error - flags is a dynamic object
            ...flags.indexing?.semantic,
            embeddings: {
              provider: options.semanticEmbedder,
            },
          },
        };
      }

      const config = ConfigLoader.load({
        configPath: globalOpts.config,
        flags,
      });

      const builder = new IndexBuilder({
        maxFileSizeBytes: config.indexing?.maxFileSizeBytes ?? 2 * 1024 * 1024,
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
          const stalenessResult = await reconcileMemoryStaleness(repoId, index, memoryStore);
          markedStaleCount = stalenessResult.markedStaleCount;
          clearedStaleCount = stalenessResult.clearedStaleCount;
          memoryStore.close();
        } catch {
          // DB file doesn't exist, so skip reconciliation
        }
      }

      let semanticResult: SemanticIndexBuildFinishedEvent['payload'] | undefined;
      if (options.semantic || config.indexing?.semantic?.enabled) {
        if (!config.indexing?.semantic?.embeddings) {
          throw new Error('Semantic indexing is enabled, but no embedder is configured.');
        }

        const finishPromise = new Promise<SemanticIndexBuildFinishedEvent['payload']>((resolve) => {
          emitter.once('semanticIndexBuildFinished', (event) => {
            resolve(event.payload);
          });
        });

        const semanticConfig = config.indexing.semantic as SemanticIndexingConfig;
        const embedder = createEmbedder(semanticConfig.embeddings);
        const semanticBuilder = new SemanticIndexBuilder();
        await semanticBuilder.build({
          repoId,
          repoRoot,
          embedder,
          runId,
        });
        semanticResult = await finishPromise;
      }

      if (globalOpts.json) {
        const output: Record<string, unknown> = {
          index,
          reconciliation: {
            markedStale: markedStaleCount,
            clearedStale: clearedStaleCount,
          },
          events,
        };
        if (semanticResult) {
          output.semanticResult = semanticResult;
        }
        console.log(JSON.stringify(output, null, 2));
      } else {
        console.log(`Successfully built index at: ${repoRoot}/.orchestrator/index`);
        console.log(`- Took ${durationMs}ms`);
        console.log(`- Indexed ${index.stats.fileCount} files`);
        console.log(`- Hashed ${index.stats.hashedCount} files`);
        if (config.memory.enabled) {
          console.log(
            `- Reconciled memory: ${markedStaleCount} marked stale, ${clearedStaleCount} cleared stale`,
          );
        }
        if (semanticResult) {
          console.log(`\nSemantic index built successfully.`);
          console.log(`  - Scanned ${semanticResult.filesScanned} files`);
          console.log(`  - Affected ${semanticResult.filesAffected} files`);
          console.log(`  - Created ${semanticResult.chunksCreated} chunks`);
          console.log(`  - Computed ${semanticResult.embeddingsComputed} embeddings`);
        }
      }
    });
}
