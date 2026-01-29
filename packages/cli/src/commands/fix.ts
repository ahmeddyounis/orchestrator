import { Command } from 'commander';

export function registerFixCommand(program: Command) {
  program
    .command('fix')
    .argument('<goal>', 'The goal to fix')
    .description('Fix an issue based on a goal')
    .action((goal) => {
      const globalOpts = program.opts();
      console.log(`Fixing goal: "${goal}"`);
      if (globalOpts.verbose) console.log('Verbose mode enabled');
      if (globalOpts.config) console.log(`Config path: ${globalOpts.config}`);
      if (globalOpts.json) console.log(JSON.stringify({ status: 'fixing', goal }));
    });
}
