#!/usr/bin/env node
import { Command } from 'commander';
import { version } from '../package.json';
import { registerRunCommand } from './commands/run';
import { registerFixCommand } from './commands/fix';
import { registerPlanCommand } from './commands/plan';
import { registerEvalCommand } from './commands/eval';

const program = new Command();

program
  .name('orchestrator')
  .description('Orchestrator CLI')
  .version(version)
  .option('--json', 'Output results as JSON')
  .option('--config <path>', 'Path to configuration file')
  .option('--verbose', 'Enable verbose logging');

registerRunCommand(program);
registerFixCommand(program);
registerPlanCommand(program);
registerEvalCommand(program);

program.parse(process.argv);