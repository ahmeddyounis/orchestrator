import { Command } from 'commander';
import { promises as fs } from 'fs';
import path from 'path';
import which from 'which';
import {
  isWindows,
  isWSL,
  Config,
  ConfigError,
  ProviderConfig,
  type Logger,
} from '@orchestrator/shared';
import { ConfigLoader, PluginLoader, PluginManager, ProviderRegistry } from '@orchestrator/core';
import {
  AnthropicAdapter,
  ClaudeCodeAdapter,
  CodexCliAdapter,
  FakeAdapter,
  GeminiCliAdapter,
  OpenAIAdapter,
  SubprocessProviderAdapter,
} from '@orchestrator/adapters';
import chalk from 'chalk';
import { findRepoRoot } from '@orchestrator/repo';

const CHECKS = {
  OK: chalk.green('✔'),
  WARN: chalk.yellow('!'),
  FAIL: chalk.red('✖'),
};

type CheckResult = [string, string];

function printResult([status, message]: CheckResult): void {
  const lines = message.split('\n');
  console.log(`${status} ${lines[0]}`);
  for (const line of lines.slice(1)) {
    console.log(`  ${line}`);
  }
}

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
    if (provider.type === 'codex_cli') {
      commandsToCheck.add(provider.command || 'codex');
    }
  }

  return await Promise.all([...commandsToCheck].map((cmd) => checkExecutable(cmd)));
}

function registerBuiltInProviderFactories(registry: ProviderRegistry): void {
  registry.registerFactory('openai', (cfg: ProviderConfig) => new OpenAIAdapter(cfg));
  registry.registerFactory('anthropic', (cfg: ProviderConfig) => new AnthropicAdapter(cfg));
  registry.registerFactory('claude_code', (cfg: ProviderConfig) => new ClaudeCodeAdapter(cfg));
  registry.registerFactory('gemini_cli', (cfg: ProviderConfig) => new GeminiCliAdapter(cfg));
  registry.registerFactory('codex_cli', (cfg: ProviderConfig) => new CodexCliAdapter(cfg));
  registry.registerFactory('fake', (cfg: ProviderConfig) => new FakeAdapter(cfg));
  registry.registerFactory('subprocess', (cfg: ProviderConfig) => {
    if (!cfg.command) {
      throw new ConfigError(`Provider type 'subprocess' requires 'command' in config.`);
    }
    return new SubprocessProviderAdapter({
      command: [cfg.command, ...(cfg.args ?? [])],
      cwdMode: cfg.cwdMode,
      envAllowlist: cfg.env,
    });
  });
}

async function checkProviderAdapters(config: Config, repoRoot: string): Promise<CheckResult[]> {
  const providers = config.providers;
  if (!providers || Object.keys(providers).length === 0) {
    return [[CHECKS.WARN, 'No providers configured.']];
  }

  const { logger } = createBufferedLogger();
  const registry = new ProviderRegistry(config);
  registerBuiltInProviderFactories(registry);

  const pluginManager = new PluginManager(config, logger, repoRoot);
  await pluginManager.load();
  pluginManager.registerProviderPlugins(registry);

  const results: CheckResult[] = [];

  const entries = Object.entries(providers).sort(([a], [b]) => a.localeCompare(b));
  for (const [providerId, providerConfig] of entries) {
    try {
      registry.getAdapter(providerId);
      results.push([
        CHECKS.OK,
        `Provider '${providerId}' (${providerConfig.type}) initialized successfully.`,
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push([
        CHECKS.FAIL,
        `Provider '${providerId}' (${providerConfig.type}) failed to initialize: ${message}`,
      ]);
    }
  }

  const { errors } = await registry.shutdownAll();
  if (errors.length > 0) {
    const ids = [...new Set(errors.map((e) => e.providerId))]
      .sort((a, b) => a.localeCompare(b))
      .join(', ');
    results.push([CHECKS.WARN, `Some providers failed to shutdown cleanly: ${ids}`]);
  }

  return results;
}

function providerRequiresApiKey(type: string): boolean {
  return type === 'openai' || type === 'anthropic';
}

function createBufferedLogger(): { logger: Logger; warnings: string[] } {
  const warnings: string[] = [];

  const logger: Logger = {
    log: () => {},
    trace: () => {},
    debug: () => {},
    info: () => {},
    warn: (message) => {
      warnings.push(message);
    },
    error: (error, message) => {
      warnings.push(message ? `${message}: ${error.message}` : error.message);
    },
    child: () => logger,
  };

  return { logger, warnings };
}

async function checkPluginStatus(config: Config, repoRoot: string): Promise<[string, string]> {
  const plugins = config.plugins;
  if (!plugins?.enabled) {
    return [CHECKS.OK, 'Plugins are disabled.'];
  }
  if (!plugins.allowlistIds || plugins.allowlistIds.length === 0) {
    return [CHECKS.WARN, 'Plugins are enabled, but no plugins are explicitly allowed.'];
  }

  const { logger, warnings } = createBufferedLogger();
  const loader = new PluginLoader(config, logger, repoRoot);
  const loaded = await loader.loadPlugins();
  const loadedIds = loaded.map((p) => p.manifest.name).sort((a, b) => a.localeCompare(b));

  const allowlist = plugins.allowlistIds;
  const missing = allowlist.filter((id) => !loadedIds.includes(id));

  if (missing.length > 0) {
    const hint = warnings.length > 0 ? ` (e.g. ${warnings[0]})` : '';
    return [CHECKS.FAIL, `Plugins enabled but failed to load: ${missing.join(', ')}.${hint}`];
  }

  return [CHECKS.OK, `Enabled plugins are loadable: ${allowlist.join(', ')}.`];
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
    const record = (result: [string, string]) => {
      results.push(result);
      printResult(result);
    };

    console.log('---------------------------------');
    console.log(chalk.bold('System Environment'));
    record(await checkWSL());
    record(await checkExecutable('git'));
    record(await checkExecutable('rg'));

    try {
      const globalOpts = program.opts();
      const repoRoot = await findRepoRoot();
      const config = ConfigLoader.load({ cwd: repoRoot, configPath: globalOpts.config });

      console.log('\n' + chalk.bold('Configuration Checks (`.orchestrator.yaml`)'));
      record(await checkProviderConfig(config));
      for (const result of await checkLocalProviderExecutables(config)) {
        record(result);
      }
      record(await checkPluginStatus(config, repoRoot));
      for (const result of checkToolExecPolicy(config)) {
        record(result);
      }

      console.log('\n' + chalk.bold('Provider Adapters'));
      for (const result of await checkProviderAdapters(config, repoRoot)) {
        record(result);
      }

      console.log('\n' + chalk.bold('Project Status'));
      record(await checkIndexingStatus(repoRoot, config));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      record([CHECKS.FAIL, `Failed to load configuration: ${message}`]);
    }

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
