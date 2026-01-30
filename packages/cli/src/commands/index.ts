import { Command } from 'commander';
import { IndexManager, findRepoRoot } from '@orchestrator/repo';
import { ConfigLoader } from '@orchestrator/core';

export function registerIndexCommand(program: Command) {
  const indexCommand = program
    .command('index')
    .description('Manage repository index');

  indexCommand
    .command('build')
    .description('Build a new repository index from scratch')
    .action(async () => {
      const globalOpts = program.opts();
      const repoRoot = await findRepoRoot();
      const config = ConfigLoader.load({ configPath: globalOpts.config });
      const manager = new IndexManager(repoRoot, config.indexing);

      const report = await manager.build();

      if (globalOpts.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(`Successfully built index at: ${report.indexPath}`);
        console.log(`Indexed ${report.fileCount} files, hashed ${report.hashedCount}.`);
      }
    });

  indexCommand
    .command('update')
    .description('Update an existing repository index')
    .action(async () => {
      const globalOpts = program.opts();
      const repoRoot = await findRepoRoot();
      const config = ConfigLoader.load({ configPath: globalOpts.config });
      const manager = new IndexManager(repoRoot, config.indexing);

      const report = await manager.update();

      if (globalOpts.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(`Successfully updated index at: ${report.indexPath}`);
        if (report.delta) {
          const { added, removed, changed } = report.delta;
          console.log(`Changes: +${added} added, -${removed} removed, ~${changed} changed.`);
        }
      }
    });

  indexCommand
    .command('status')
    .description('Get the status of the repository index')
    .action(async () => {
      const globalOpts = program.opts();
      const repoRoot = await findRepoRoot();
      const config = ConfigLoader.load({ configPath: globalOpts.config });
      const manager = new IndexManager(repoRoot, config.indexing);
      const report = await manager.status();

      if (globalOpts.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        if (report) {
          console.log(`Index found at: ${report.indexPath}`);
          console.log(`Last updated: ${report.updatedAt}`);
          console.log(`Total files: ${report.fileCount}`);
        } else {
          console.warn('No index found for this repository.');
        }
      }
    });
}
