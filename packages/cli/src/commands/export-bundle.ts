import { Command } from 'commander';
import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import path from 'path';
import archiver from 'archiver';
import { ConfigLoader } from '@orchestrator/core';
import { findRepoRoot } from '@orchestrator/repo';
import { redactObject } from '@orchestrator/shared';
import chalk from 'chalk';

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

  command.description('Create a zip bundle with debugging information.').action(async () => {
    console.log(chalk.bold('Creating debug bundle...'));

    const repoRoot = await findRepoRoot();
    const config = ConfigLoader.load({ cwd: repoRoot });
    const redactedConfig = redactObject(config);

    const bundleInfo = {
      versionInfo: getVersionInfo(),
      config: redactedConfig,
      indexing: await getIndexStats(),
      plugins: {
        enabled: config.plugins?.enabled,
        paths: config.plugins?.paths,
        allowlistIds: config.plugins?.allowlistIds,
      },
    };

    const output = fs.createWriteStream(path.join(process.cwd(), 'orchestrator-bundle.zip'));
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

    const logDir = path.join(repoRoot, '.orchestrator', 'logs');
    try {
      if ((await fsp.stat(logDir)).isDirectory()) {
        archive.directory(logDir, 'logs');
      }
    } catch {
      // log dir doesn't exist, do nothing
    }

    await archive.finalize();

    console.log(
      chalk.green.bold(
        `\nSuccessfully created bundle: ${path.resolve(process.cwd(), 'orchestrator-bundle.zip')}`,
      ),
    );
    console.log('Please attach this file to your GitHub issue, after verifying its contents.');
  });

  program.addCommand(command);
};
