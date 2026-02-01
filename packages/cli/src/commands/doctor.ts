import { Command } from 'commander';
import { OutputRenderer } from '../output/renderer';
import { findRepoRoot, GitService } from '@orchestrator/repo';
import { ConfigLoader } from '@orchestrator/core';
import semver from 'semver';
import { execSync } from 'child_process';

interface DoctorCheck {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  remediation?: string;
}

async function checkNodeVersion(): Promise<DoctorCheck> {
  const requiredVersion = '>=18.0.0';
  const currentVersion = process.version;
  if (semver.satisfies(currentVersion, requiredVersion)) {
    return {
      name: 'Node.js version',
      status: 'ok',
      message: `Version ${currentVersion} satisfies ${requiredVersion}`,
    };
  }
  return {
    name: 'Node.js version',
    status: 'error',
    message: `Current version ${currentVersion} does not satisfy ${requiredVersion}`,
    remediation: `Please upgrade Node.js to a version that satisfies ${requiredVersion}.`,
  };
}

async function checkRepoRoot(): Promise<DoctorCheck> {
  try {
    const repoRoot = await findRepoRoot();
    return {
      name: 'Repository root',
      status: 'ok',
      message: `Found repository root at ${repoRoot}`,
    };
  } catch {
    return {
      name: 'Repository root',
      status: 'error',
      message: 'Could not find repository root.',
      remediation: 'Ensure you are running orchestrator from within a git repository.',
    };
  }
}

async function checkGit(): Promise<DoctorCheck> {
  try {
    execSync('git --version', { stdio: 'pipe' });
    return {
      name: 'Git',
      status: 'ok',
      message: 'Git is installed.',
    };
  } catch {
    return {
      name: 'Git',
      status: 'error',
      message: 'Git is not installed.',
      remediation: 'Please install git and ensure it is in your PATH.',
    };
  }
}

async function checkGitCleanState(): Promise<DoctorCheck> {
  try {
    const repoRoot = await findRepoRoot();
    const git = new GitService({ repoRoot });
    const isClean = await git.isWorkingTreeClean();
    if (isClean) {
      return {
        name: 'Git clean working tree',
        status: 'ok',
        message: 'Git working tree is clean.',
      };
    } else {
      return {
        name: 'Git clean working tree',
        status: 'warn',
        message: 'Git working tree is not clean. This can lead to unexpected behavior.',
        remediation: 'Please commit or stash your changes before running orchestrator.',
      };
    }
  } catch {
    return {
      name: 'Git clean working tree',
      status: 'warn',
      message: 'Could not check git status. Assuming it is not clean.',
    };
  }
}

async function checkRg(): Promise<DoctorCheck> {
  try {
    execSync('rg --version', { stdio: 'pipe' });
    return {
      name: 'ripgrep (rg)',
      status: 'ok',
      message: 'ripgrep is installed.',
    };
  } catch {
    return {
      name: 'ripgrep (rg)',
      status: 'warn',
      message: 'ripgrep is not installed. Some features might be slower.',
      remediation:
        'For better performance, install ripgrep: https://github.com/BurntSushi/ripgrep#installation',
    };
  }
}

async function checkProviderConfig(configPath?: string): Promise<DoctorCheck> {
  try {
    const config = ConfigLoader.load({ configPath });
    const providers = config.providers || {};
    const providerIds = Object.keys(providers);

    if (providerIds.length === 0) {
      return {
        name: 'Provider configuration',
        status: 'warn',
        message: 'No providers configured in orchestrator.yaml.',
        remediation:
          'Please configure at least one provider (e.g., openai, anthropic) in your .orchestrator.yaml file.',
      };
    }

    const checks = providerIds.map((id) => {
      const provider = providers[id];
      if (provider.apiKey) {
        return { id, hasApiKey: true, hasEnvVar: false };
      }
      if (provider.apiKeyFromEnv) {
        return { id, hasApiKey: false, hasEnvVar: !!process.env[provider.apiKeyFromEnv] };
      }
      return { id, hasApiKey: false, hasEnvVar: false };
    });

    const misconfigured = checks.filter((c) => !c.hasApiKey && !c.hasEnvVar);

    if (misconfigured.length > 0) {
      const providerNames = misconfigured.map((c) => `'${c.id}'`).join(', ');
      return {
        name: 'Provider configuration',
        status: 'warn',
        message: `API keys for providers ${providerNames} are not configured.`,
        remediation: `Please set the API keys either directly in the config (not recommended) or via the specified environment variables.`,
      };
    }

    return {
      name: 'Provider configuration',
      status: 'ok',
      message: 'Provider configuration looks good.',
    };
  } catch (e) {
    if (e instanceof Error && e.message.includes('not found')) {
      return {
        name: 'Provider configuration',
        status: 'warn',
        message: 'No .orchestrator.yaml found.',
        remediation: 'You can create one by running `orchestrator init`.',
      };
    }
    return {
      name: 'Provider configuration',
      status: 'error',
      message: `Error loading configuration: ${(e as Error).message}`,
    };
  }
}

async function checkExternalWorkers(configPath?: string): Promise<DoctorCheck> {
  const config = ConfigLoader.load({ configPath });
  const claudeCodeConfig = Object.values(config.providers || {}).find(
    (p) => p.type === 'claude_code',
  );

  if (!claudeCodeConfig) {
    return {
      name: 'External Workers',
      status: 'ok',
      message: 'No external workers configured.',
    };
  }

  try {
    execSync('claude --version', { stdio: 'pipe' });
    return {
      name: 'External Workers (claude_code)',
      status: 'ok',
      message: 'claude CLI is installed.',
    };
  } catch {
    return {
      name: 'External Workers (claude_code)',
      status: 'error',
      message: 'claude_code provider is configured, but the `claude` CLI is not found.',
      remediation: 'Please install the claude CLI: `npm i -g @anthropic-ai/claude-cli`',
    };
  }
}

export function registerDoctorCommand(program: Command) {
  program
    .command('doctor')
    .description('Check for common configuration and environment issues')
    .option('--json', 'Output results in JSON format')
    .action(async (options) => {
      const renderer = new OutputRenderer(!!options.json);
      const globalOpts = program.opts();

      const checks: DoctorCheck[] = [];
      let hasError = false;

      try {
        const allChecks = await Promise.all([
          checkNodeVersion(),
          checkRepoRoot(),
          checkGit(),
          checkGitCleanState(),
          checkRg(),
          checkProviderConfig(globalOpts.config),
          checkExternalWorkers(globalOpts.config),
        ]);
        checks.push(...allChecks);

        hasError = checks.some((c) => c.status === 'error');

        if (options.json) {
          console.log(JSON.stringify({ checks }, null, 2));
        } else {
          renderer.log('Orchestrator Doctor');
          checks.forEach((check) => {
            let icon = '✓';
            if (check.status === 'warn') icon = '⚠';
            if (check.status === 'error') icon = '✗';
            renderer.log(` ${icon} ${check.name}: ${check.message}`);
            if (check.remediation) {
              renderer.log(`   └─ ${check.remediation}`);
            }
          });

          if (hasError) {
            renderer.error('\nDoctor found issues that must be resolved.');
          } else if (checks.some((c) => c.status === 'warn')) {
            renderer.log('\nDoctor found some warnings. Review them for a better experience.');
          } else {
            renderer.log('\nAll checks passed! ✨');
          }
        }
      } catch (err: unknown) {
        if (err instanceof Error) {
          renderer.error(err.message);
        } else {
          renderer.error('An unknown error occurred during doctor check');
          console.error(err);
        }
        hasError = true;
      }
      process.exit(hasError ? 1 : 0);
    });
}