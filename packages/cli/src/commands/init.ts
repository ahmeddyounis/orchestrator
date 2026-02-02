import { Command } from 'commander';
import { promises as fs } from 'fs';
import path from 'path';
import { findRepoRoot } from '@orchestrator/repo';
import { OutputRenderer } from '../output/renderer';
import { ConsoleUI } from '../ui/console';

const defaultConfig = `
# Orchestrator Configuration File
# For more information, see: https://github.com/moonrise-inc/orchestrator/blob/main/docs/config.md

configVersion: 1

# Default providers to use for different agentic steps.
# Must match a key in the 'providers' section below.
defaults:
  planner: openai
  executor: openai
  reviewer: openai

# Configuration for different AI providers.
providers:
  openai:
    type: openai
    # We recommend using environment variables for API keys.
    # api_key: "sk-..."
    api_key_env: OPENAI_API_KEY
    # You can specify a default model for each provider.
    model: gpt-4-turbo

  # anthropic:
  #   type: anthropic
  #   api_key_env: ANTHROPIC_API_KEY
  #   model: claude-3-opus-20240229

# Settings for the agent execution environment.
execution:
  # Tool usage policy.
  tools:
    # Whether tools are enabled at all.
    enabled: true
    # Whether to ask for confirmation before executing a tool.
    requireConfirmation: true
    # If true, auto-approve all confirmations except those on the denylist.
    autoApprove: false

# Memory settings for the orchestrator.
memory:
  enabled: false

# Telemetry settings. For more details, see docs/telemetry.md
# We take your privacy seriously. Telemetry is disabled by default.
telemetry:
  enabled: false
  # Mode can be 'local' or 'remote'. Currently, only 'local' is supported.
  mode: local
  # Redact secrets and sensitive information from telemetry data.
  redact: true
`;

export function registerInitCommand(program: Command) {
  program
    .command('init')
    .description('Create a default .orchestrator.yaml configuration file')
    .action(async () => {
      const renderer = new OutputRenderer(false);
      const ui = new ConsoleUI();

      try {
        const repoRoot = await findRepoRoot();
        const configPath = path.join(repoRoot, '.orchestrator.yaml');

        try {
          await fs.access(configPath);
          renderer.log('An .orchestrator.yaml file already exists.');
          const overwrite = await ui.confirm('Do you want to overwrite it?');
          if (!overwrite) {
            renderer.log('Aborted.');
            process.exit(0);
          }
        } catch {
          // File does not exist, which is the normal case.
        }

        const confirmed = await ui.confirm('Create .orchestrator.yaml in the repository root?');

        if (confirmed) {
          await fs.writeFile(configPath, defaultConfig.trim());
          renderer.log(`Successfully created .orchestrator.yaml at ${configPath}`);
          renderer.log(`\nNext steps:`);
          renderer.log(
            `  1. Add your API keys to your environment (e.g., export OPENAI_API_KEY=sk-...)`,
          );
          renderer.log(`  2. Run 'orchestrator doctor' to verify your setup.`);
          renderer.log(`  3. Run 'orchestrator run "your goal here"' to start.`);
        } else {
          renderer.log('Aborted.');
        }
        process.exit(0);
      } catch (err: unknown) {
        if (err instanceof Error) {
          renderer.error(err.message);
        } else {
          renderer.error('An unknown error occurred during init');
          console.error(err);
        }
        process.exit(1);
      }
    });
}
