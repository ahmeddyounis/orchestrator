import { Command } from 'commander';
import { promises as fs } from 'fs';
import path from 'path';
import which from 'which';
import { isWindows, isWSL, Config } from '@orchestrator/shared';
import { ConfigLoader } from '@orchestrator/core';
import chalk from 'chalk';
import { findRepoRoot } from '@orchestrator/repo';

const CHECKS = {
  OK: chalk.green('✔'),
  WARN: chalk.yellow('!'),
  FAIL: chalk.red('✖'),
};

async function checkExecutable(name: string): Promise<[string, string]> {
  try {
    const path = await which(name);
    return [CHECKS.OK, `${name} found at: ${path}`];
  } catch {
    return [CHECKS.FAIL, `${name} not found in PATH.`];
  }
}

async function checkWSL(): Promise<[string, string]> {
  if (isWSL()) {
    return [CHECKS.OK, 'Running inside WSL. This is a supported environment.'];
  }
  if (isWindows()) {
    return [
      CHECKS.WARN,
      'Running on native Windows. Full support is experimental. Please use WSL for the best experience.',
    ];
  }
  return [CHECKS.OK, `Running on ${process.platform}. This is a supported environment.`];
}

async function checkProviderConfig(config: Config): Promise<[string, string]> {
  const providers = config.providers;
  if (!providers || Object.keys(providers).length === 0) {
    return [CHECKS.WARN, 'No providers configured. LLM calls will fail.'];
  }

  const providerNames = Object.keys(providers);
  const warnings: string[] = [];
  for (const name of providerNames) {
    const provider = providers[name];
    if (providerRequiresApiKey(provider.type) && !provider.api_key && !provider.api_key_env) {
      warnings.push(`Provider '${name}' (${provider.type}) is missing an api_key or api_key_env.`);
    }
  }
  const defaultPlanner = config.defaults?.planner || 'not set';

  if (warnings.length > 0) {
    return [CHECKS.WARN, warnings.join(' ')];
  }

  return [
    CHECKS.OK,
    `Providers configured: ${providerNames.join(', ')}. Default planner: ${defaultPlanner}`,
  ];
}

async function checkLocalProviderExecutables(config: Config): Promise<[string, string][]> {
  const providers = config.providers;
  if (!providers) return [];

  const commandsToCheck = new Set<string>();
  for (const provider of Object.values(providers)) {
    if (provider.type === 'claude_code') {
      commandsToCheck.add(provider.command || 'claude');
    }
    if (provider.type === 'gemini_cli') {
      commandsToCheck.add(provider.command || 'gemini');
    }
  }

  return await Promise.all([...commandsToCheck].map((cmd) => checkExecutable(cmd)));
}

function providerRequiresApiKey(type: string): boolean {
  return type === 'openai' || type === 'anthropic';
}

async function checkPluginStatus(config: Config): Promise<[string, string]> {
  const plugins = config.plugins;
  if (!plugins?.enabled) {
    return [CHECKS.OK, 'Plugins are disabled.'];
  }
  if (!plugins.allowlistIds || plugins.allowlistIds.length === 0) {
    return [CHECKS.WARN, 'Plugins are enabled, but no plugins are explicitly allowed.'];
  }
  return [CHECKS.OK, `Enabled plugins: ${plugins.allowlistIds.join(', ')}.`];
}

function checkToolExecPolicy(config: Config): [string, string][] {
  const tools = config.execution?.tools;
  const results: [string, string][] = [];

  if (!tools?.enabled) {
    results.push([CHECKS.OK, 'Tool execution is disabled.']);
    return results;
  }

  results.push([CHECKS.WARN, 'Tool execution is enabled.']);

  if (tools.requireConfirmation) {
    results.push([CHECKS.OK, 'Tool execution requires confirmation (safe default).']);
  } else {
    results.push([CHECKS.WARN, 'Tool execution does NOT require confirmation.']);
  }

  if (tools.networkPolicy === 'deny') {
    results.push([CHECKS.OK, 'Tool network access is denied (safe default).']);
  } else {
    results.push([CHECKS.WARN, `Tool network access is '${tools.networkPolicy}'.`]);
  }

  if (tools.allowShell) {
    results.push([CHECKS.WARN, `Shell access is allowed for tools.`]);
  } else {
    results.push([CHECKS.OK, `Shell access is disabled for tools (safe default).`]);
  }

  return results;
}

async function checkIndexingStatus(repoRoot: string, config?: Config): Promise<[string, string]> {
  try {
    const indexRelPath = config?.indexing?.path ?? '.orchestrator/index/index.json';
    const indexPath = path.isAbsolute(indexRelPath)
      ? indexRelPath
      : path.join(repoRoot, indexRelPath);
    const stats = await fs.stat(indexPath);
    return [CHECKS.OK, `Index found. Last modified: ${stats.mtime.toLocaleDateString()}`];
  } catch {
    return [CHECKS.WARN, 'Project index not found. Run `orchestrator index build`.'];
  }
}

export const registerDoctorCommand = (program: Command) => {
  const command = new Command('doctor');

  command.description('Run checks to diagnose issues with the environment.').action(async () => {
    console.log(chalk.bold('Orchestrator Environment Checkup'));

    const results: Array<[string, string]> = [];

    console.log('---------------------------------');
    console.log(chalk.bold('System Environment'));
    results.push(await checkWSL());
    results.push(await checkExecutable('git'));
    results.push(await checkExecutable('rg'));

    try {
      const globalOpts = program.opts();
      const repoRoot = await findRepoRoot();
      const config = ConfigLoader.load({ cwd: repoRoot, configPath: globalOpts.config });

      console.log('\n' + chalk.bold('Configuration Checks (`.orchestrator.yaml`)'));
      results.push(await checkProviderConfig(config));
      results.push(...(await checkLocalProviderExecutables(config)));
      results.push(await checkPluginStatus(config));
      results.push(...checkToolExecPolicy(config));

      console.log('\n' + chalk.bold('Project Status'));
      results.push(await checkIndexingStatus(repoRoot, config));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      results.push([CHECKS.FAIL, `Failed to load configuration: ${message}`]);
    }

    results.forEach(([status, message]) => {
      console.log(`${status} ${message}`);
    });

    console.log('---------------------------------');

    const hasFailures = results.some(([status]) => status === CHECKS.FAIL);
    if (hasFailures) {
      console.log(
        chalk.red.bold('Doctor checks failed.') +
          ' Please resolve the issues marked with ' +
          CHECKS.FAIL,
      );
      console.log(
        'See documentation for setup instructions: https://orchestrator.dev/docs/quickstart',
      );
    } else {
      console.log(chalk.green.bold('All checks passed. Your environment looks good!'));
    }
  });

  program.addCommand(command);
};
