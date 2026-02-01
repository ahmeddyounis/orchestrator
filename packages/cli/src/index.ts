#!/usr/bin/env node
import { Command } from 'commander';
import { version } from '../package.json';
import { registerRunCommand } from './commands/run';
import { registerFixCommand } from './commands/fix';
import { registerPlanCommand } from './commands/plan';
import { registerEvalCommand } from './commands/eval';
import { registerMemoryCommand } from './commands/memory';
import { registerIndexCommand } from './commands/index';
import { registerDoctorCommand } from './commands/doctor';
import { registerInitCommand } from './commands/init';

const program = new Command();

program
  .name('orchestrator')
  .description('Orchestrator CLI')
  .version(version)
  .option('--json', 'Output results as JSON')
  .option('--config <path>', 'Path to configuration file')
  .option('--verbose', 'Enable verbose logging')
  .option('--yes', 'Automatically answer "yes" to all prompts')
  .option('--non-interactive', 'Disable interactive prompts (fail if prompt needed)');

registerRunCommand(program);
registerFixCommand(program);
registerPlanCommand(program);
registerEvalCommand(program);
registerMemoryCommand(program);
registerIndexCommand(program);
registerDoctorCommand(program);
registerInitCommand(program);

program.parse(process.argv);
