import { Command } from 'commander';
import path from 'node:path';
import { IndexBuilder, findRepoRoot, SemanticIndexBuilder, emitter } from '@orchestrator/repo';
import { ConfigLoader, reconcileMemoryStaleness, type DeepPartial } from '@orchestrator/core';
import { createMemoryStore } from '@orchestrator/memory';
import type { Config } from '@orchestrator/shared';
import { GlobalOptions } from '../../types';
import { statSync } from 'node:fs';
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

      const builder = new IndexBuilder({
        maxFileSizeBytes: config.indexing?.maxFileSizeBytes ?? 2 * 1024 * 1024,
      });

      const startTime = Date.now();
      const index = await builder.build(repoRoot);
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
          const stalenessResult = await reconcileMemoryStaleness(repoId, index, memoryStore);
          markedStaleCount = stalenessResult.markedStaleCount;
          clearedStaleCount = stalenessResult.clearedStaleCount;
          memoryStore.close();
        } catch {
          // DB file doesn't exist, so skip reconciliation
        }
      }

      type SemanticBuildResult = {
        repoId: string;
        filesProcessed: number;
        chunksEmbedded: number;
        durationMs: number;
      };

      let semanticResult: SemanticBuildResult | undefined;
      const semanticConfig = config.indexing?.semantic;
      if (options.semantic || semanticConfig?.enabled) {
        if (!semanticConfig) {
          throw new Error('Semantic indexing is enabled, but no semantic config is present.');
        }

        const finishPromise = new Promise<SemanticBuildResult>((resolve) => {
          emitter.once('semanticIndexBuildFinished', (event) => {
            resolve(event);
          });
        });

        const embedder = createEmbedder(semanticConfig.embeddings);
        const semanticBuilder = new SemanticIndexBuilder();
        await semanticBuilder.build({
          repoId,
          repoRoot,
          embedder,
          maxFileSizeBytes: config.indexing?.maxFileSizeBytes,
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
          console.log(`  - Processed ${semanticResult.filesProcessed} files`);
          console.log(`  - Embedded ${semanticResult.chunksEmbedded} chunks`);
          console.log(`  - Took ${semanticResult.durationMs}ms`);
        }
      }
    });
}
