import { Command } from 'commander';
import { getIndexStatus } from '@orchestrator/repo';
import { GlobalOptions } from '../../types';
import { printTable } from '../../output';
import { getOrchestratorConfig } from '@orchestrator/core';

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

      const flags: any = {};
      if (options.semantic) {
        flags.indexing = { semantic: { enabled: true } };
      }

      const config = await getOrchestratorConfig(globalOpts.config, flags);

      const status = await getIndexStatus(config);

      if (globalOpts.json) {
        const output: any = { ...status };
        if (options.semantic) {
          output.config = config.indexing?.semantic;
        }
        console.log(JSON.stringify(output, null, 2));
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
        console.log('\nDrift from repository:');
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
          console.log('\nTop changed paths:');
          status.drift.changes.modified.forEach((p) => console.log(`- ${p}`));
        }

        const totalDrift =
          status.drift.addedCount + status.drift.changedCount + status.drift.removedCount;
        if (totalDrift > 0) {
          console.log("\nRun 'orchestrator index update' to sync the index.");
        } else {
          console.log('\n✅ Index is up-to-date.');
        }
      }
    });
}
