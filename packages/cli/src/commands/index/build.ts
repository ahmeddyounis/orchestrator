import { Command } from 'commander';
import { IndexBuilder, findRepoRoot, IndexFile } from '@orchestrator/repo';
import { GlobalOptions } from '../../types';

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

      const repoRoot = await findRepoRoot();
      const builder = new IndexBuilder();

      const startTime = Date.now();
      const index = await builder.build(repoRoot);
      const durationMs = Date.now() - startTime;

      if (globalOpts.json) {
        console.log(JSON.stringify(index, null, 2));
      } else {
        console.log(`Successfully built index at: ${repoRoot}/.orchestrator/index`);
        console.log(`- Took ${durationMs}ms`);
        console.log(`- Indexed ${index.files.length} files`);
        console.log(
          `- Hashed ${index.files.filter((f: IndexFile) => f.sha256).length} files`,
        );
      }
    });
}
