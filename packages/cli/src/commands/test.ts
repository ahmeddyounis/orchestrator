import { Command } from 'commander';
import { execa } from 'execa';
import { findRepoRoot } from '@orchestrator/repo';

export function registerTestCommand(program: Command) {
  program
    .command('test')
    .description('Run tests for the project')
    .action(async () => {
      const repoRoot = await findRepoRoot();
      try {
        const testProcess = execa('turbo', ['run', 'test'], {
          cwd: repoRoot,
          stdio: 'inherit',
        });
        await testProcess;
      } catch (_error) {
        // execa throws an error if the command fails, which is what we want.
        // The error message will be printed to stderr.
        process.exit(1);
      }
    });
}
