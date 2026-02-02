import { Command } from 'commander';
import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import path from 'path';
import archiver from 'archiver';
import { ConfigLoader } from '@orchestrator/core';
import { findRepoRoot } from '@orchestrator/repo';
import { redactObject } from '@orchestrator/shared';
import chalk from 'chalk';

type RunEntry = { runId: string; startedAtMs: number; mtimeMs: number };

async function getIndexStats() {
  try {
    const repoRoot = await findRepoRoot();
    const indexPath = path.join(repoRoot, '.orchestrator', 'index', 'index.json');
    const content = await fsp.readFile(indexPath, 'utf-8');
    const index = JSON.parse(content) as { files?: Record<string, unknown>; lastUpdated?: string };
    return {
      files: Object.keys(index.files ?? {}).length,
      lastUpdated: index.lastUpdated ? new Date(index.lastUpdated).toISOString() : 'N/A',
    };
  } catch {
    return {
      files: 0,
      lastUpdated: 'N/A',
    };
  }
}

async function resolveLatestRunIds(runsDir: string, limit: number): Promise<string[]> {
  const entries: RunEntry[] = [];

  try {
    const dirents = await fsp.readdir(runsDir, { withFileTypes: true });
    for (const d of dirents) {
      if (!d.isDirectory()) continue;
      const runId = d.name;
      const runDir = path.join(runsDir, runId);
      let startedAtMs = Number.NaN;

      try {
        const manifestPath = path.join(runDir, 'manifest.json');
        const manifestRaw = await fsp.readFile(manifestPath, 'utf-8');
        const manifest = JSON.parse(manifestRaw) as { startedAt?: string };
        startedAtMs = manifest.startedAt ? Date.parse(manifest.startedAt) : Number.NaN;
      } catch {
        // ignore
      }

      let mtimeMs = 0;
      try {
        const st = await fsp.stat(runDir);
        mtimeMs = st.mtimeMs;
      } catch {
        // ignore
      }

      entries.push({ runId, startedAtMs, mtimeMs });
    }
  } catch {
    return [];
  }

  entries.sort((a, b) => {
    const aKey = Number.isFinite(a.startedAtMs) ? a.startedAtMs : a.mtimeMs;
    const bKey = Number.isFinite(b.startedAtMs) ? b.startedAtMs : b.mtimeMs;
    return bKey - aKey;
  });

  return entries.slice(0, Math.max(0, limit)).map((e) => e.runId);
}

function getVersionInfo() {
  try {
    const cliPackageJsonPath = path.resolve(__dirname, '..', '..', 'package.json');
    const cliPackageJson = JSON.parse(fs.readFileSync(cliPackageJsonPath, 'utf8')) as {
      version?: string;
    };
    return {
      cliVersion: cliPackageJson.version ?? 'unknown',
      nodeVersion: process.version,
      platform: process.platform,
    };
  } catch {
    return {
      cliVersion: 'unknown',
      nodeVersion: process.version,
      platform: process.platform,
    };
  }
}

export const registerExportBundleCommand = (program: Command) => {
  const command = new Command('export-bundle');

  command
    .description('Create a zip bundle with debugging information.')
    .option('--run <runId>', 'Include a specific run directory')
    .option('--runs <n>', 'Include the latest N runs (default: 1)', '1')
    .option('--output <path>', 'Output zip path', 'orchestrator-bundle.zip')
    .action(async (options: { run?: string; runs: string; output: string }) => {
      console.log(chalk.bold('Creating debug bundle...'));

      const repoRoot = await findRepoRoot();
      const config = ConfigLoader.load({ cwd: repoRoot });
      const redactedConfig = redactObject(config);

      const runsDir = path.join(repoRoot, '.orchestrator', 'runs');
      const requestedRunCount = Number(options.runs);
      const runCount = Number.isInteger(requestedRunCount) ? requestedRunCount : 1;
      const selectedRuns = options.run
        ? [options.run]
        : await resolveLatestRunIds(runsDir, Math.max(1, runCount));

      const bundleInfo = {
        versionInfo: getVersionInfo(),
        config: redactedConfig,
        indexing: await getIndexStats(),
        plugins: {
          enabled: config.plugins?.enabled,
          paths: config.plugins?.paths,
          allowlistIds: config.plugins?.allowlistIds,
        },
        includedRuns: selectedRuns,
      };

      const outputPath = path.resolve(process.cwd(), options.output);
      await fsp.mkdir(path.dirname(outputPath), { recursive: true });

      const output = fs.createWriteStream(outputPath);
      const archive = archiver('zip', {
        zlib: { level: 9 },
      });

      archive.on('warning', (err) => {
        if (err.code === 'ENOENT') {
          console.warn(chalk.yellow(err.message));
        } else {
          throw err;
        }
      });

      archive.on('error', (err) => {
        throw err;
      });

      archive.pipe(output);

      archive.append(JSON.stringify(bundleInfo, null, 2), { name: 'bundle-info.json' });

      // Include project config file if present
      const configPath = path.join(repoRoot, '.orchestrator.yaml');
      try {
        if ((await fsp.stat(configPath)).isFile()) {
          archive.file(configPath, { name: '.orchestrator.yaml' });
        }
      } catch {
        // ignore
      }

      // Include index if present
      const indexDir = path.join(repoRoot, '.orchestrator', 'index');
      try {
        if ((await fsp.stat(indexDir)).isDirectory()) {
          archive.directory(indexDir, 'index');
        }
      } catch {
        // ignore
      }

      // Backward-compat: include legacy logs dir if present
      const logDir = path.join(repoRoot, '.orchestrator', 'logs');
      try {
        if ((await fsp.stat(logDir)).isDirectory()) {
          archive.directory(logDir, 'logs');
        }
      } catch {
        // ignore
      }

      // Include runs
      for (const runId of selectedRuns) {
        const runDir = path.join(runsDir, runId);
        try {
          if ((await fsp.stat(runDir)).isDirectory()) {
            archive.directory(runDir, path.posix.join('runs', runId));
          }
        } catch {
          // ignore
        }
      }

      await archive.finalize();

      console.log(chalk.green.bold(`\nSuccessfully created bundle: ${outputPath}`));
      console.log('Please attach this file to your GitHub issue, after verifying its contents.');
    });

  program.addCommand(command);
};
