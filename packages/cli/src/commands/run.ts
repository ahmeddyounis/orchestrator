import { Command } from 'commander';

export function registerRunCommand(program: Command) {
  program
    .command('run')
    .argument('<goal>', 'The goal to run')
    .description('Run an agentic task to achieve a goal')
    .action((goal) => {
      const globalOpts = program.opts();
      console.log(`Running goal: "${goal}"`);
      if (globalOpts.verbose) console.log('Verbose mode enabled');
      if (globalOpts.config) console.log(`Config path: ${globalOpts.config}`);
      if (globalOpts.json) console.log(JSON.stringify({ status: 'running', goal }));
    });
}
