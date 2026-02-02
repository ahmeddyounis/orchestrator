import { Command } from 'commander';
import { getIndexStatus, findRepoRoot, SemanticIndexStore } from '@orchestrator/repo';
import { GlobalOptions } from '../../types';
import { printTable } from '../../output';
import { ConfigLoader, type DeepPartial } from '@orchestrator/core';
import path from 'node:path';
import { statSync } from 'node:fs';
import type { Config } from '@orchestrator/shared';

export function registerIndexStatusCommand(parent: Command) {
  parent
    .command('status')
    .description('Show repository index status and drift')
    .option('--semantic', 'Show semantic index status', false)
    .action(async (options, command: Command) => {
      let program = command.parent;
      while (program?.parent) {
        program = program.parent;
      }
      const globalOpts = program!.opts() as GlobalOptions;

      const flags: DeepPartial<Config> = {};
      if (options.semantic) {
        flags.indexing = { semantic: { enabled: true } };
      }

      const repoRoot = await findRepoRoot();
      const config = ConfigLoader.load({
        configPath: globalOpts.config,
        cwd: repoRoot,
        flags,
      });

      if (options.semantic) {
        const semanticConfig = config.indexing?.semantic;
        if (!semanticConfig?.enabled) {
          console.error('Semantic indexing is not enabled. Please enable it in your config.');
          process.exit(1);
        }

        const dbPath = path.isAbsolute(semanticConfig.storage.path)
          ? semanticConfig.storage.path
          : path.join(repoRoot, semanticConfig.storage.path);
        try {
          statSync(dbPath);
        } catch {
          console.error(`Semantic index not found at ${dbPath}`);
          console.error("Run 'orchestrator index build --semantic' to create one.");
          process.exit(1);
        }

        const store = new SemanticIndexStore();
        store.init(dbPath);
        const meta = store.getMeta();
        const stats = store.getStats();
        store.close();

        if (globalOpts.json) {
          console.log(JSON.stringify({ meta, stats }, null, 2));
          return;
        }

        if (!meta) {
          console.log('❌ Semantic index metadata not found.');
          return;
        }

        console.log(`✅ Semantic Index found at: ${dbPath}`);
        const data = [
          { key: 'Embedder', value: meta.embedderId },
          { key: 'Dimensions', value: meta.dims },
          { key: 'Built At', value: new Date(meta.builtAt).toISOString() },
          { key: 'Updated At', value: new Date(meta.updatedAt).toISOString() },
          { key: 'Files', value: stats.fileCount },
          { key: 'Chunks', value: stats.chunkCount },
          { key: 'Embeddings', value: stats.embeddingCount },
        ];
        printTable(data, {
          head: ['Metric', 'Value'],
          colAligns: ['right', 'left'],
        });
        return;
      }

      // Procedural index status
      const status = await getIndexStatus({
        ...config,
        rootDir: repoRoot,
        orchestratorDir: path.join(repoRoot, '.orchestrator'),
      });

      if (globalOpts.json) {
        console.log(JSON.stringify(status, null, 2));
        return;
      }

      if (!status.isIndexed) {
        console.log('❌ Index not found.');
        console.log("Run 'orchestrator index build' to create one.");
        return;
      }

      console.log(`✅ Index found at: ${status.indexPath}`);

      const data = [
        { key: 'Built At', value: status.builtAt },
        { key: 'Updated At', value: status.updatedAt },
        { key: 'Files', value: status.fileCount },
        { key: 'Hashed', value: status.hashedCount },
      ];
      printTable(data, {
        head: ['Metric', 'Value'],
        colAligns: ['right', 'left'],
      });

      if (status.drift) {
        console.log('\\nDrift from repository:');
        const driftData = [
          { key: 'Added', value: status.drift.addedCount },
          { key: 'Changed', value: status.drift.changedCount },
          { key: 'Removed', value: status.drift.removedCount },
        ];
        printTable(driftData, {
          head: ['Type', 'Count'],
          colAligns: ['right', 'left'],
        });

        if (status.drift.changes.modified.length > 0) {
          console.log('\\nTop changed paths:');
          status.drift.changes.modified.forEach((p) => console.log(`- ${p}`));
        }

        const totalDrift =
          status.drift.addedCount + status.drift.changedCount + status.drift.removedCount;
        if (totalDrift > 0) {
          console.log("\\nRun 'orchestrator index update' to sync the index.");
        } else {
          console.log('\\n✅ Index is up-to-date.');
        }
      }
    });
}
