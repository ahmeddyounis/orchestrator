import { Command } from 'commander';

export function registerEvalCommand(program: Command) {
  program
    .command('eval')
    .requiredOption('--suite <path>', 'Path to the evaluation suite')
    .description('Run an evaluation suite')
    .action((options) => {
      const globalOpts = program.opts();
      console.log(`Evaluating suite: "${options.suite}"`);
      if (globalOpts.verbose) console.log('Verbose mode enabled');
      if (globalOpts.config) console.log(`Config path: ${globalOpts.config}`);
      if (globalOpts.json) console.log(JSON.stringify({ status: 'evaluating', suite: options.suite }));
    });
}
