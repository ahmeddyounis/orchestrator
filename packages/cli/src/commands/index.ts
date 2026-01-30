import { Command } from 'commander';
import { IndexBuilder, findRepoRoot } from '@orchestrator/repo';

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
      const builder = new IndexBuilder();

      const index = await builder.build(repoRoot);

      if (globalOpts.json) {
        console.log(JSON.stringify(index, null, 2));
      } else {
        console.log(`Successfully built index for: ${index.repoRoot}`);
        console.log(`Indexed ${index.stats.fileCount} files, hashed ${index.stats.hashedCount}.`);
      }
    });
}
