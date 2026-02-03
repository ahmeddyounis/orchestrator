import fs from 'node:fs/promises';
import path from 'node:path';
import { ToolchainProfile, PackageManager, ToolchainCommands } from './types';

export class ToolchainDetector {
  async detect(rootPath: string): Promise<ToolchainProfile> {
    const pnpmWorkspacePath = path.join(rootPath, 'pnpm-workspace.yaml');
    const turboJsonPath = path.join(rootPath, 'turbo.json');
    const packageJsonPath = path.join(rootPath, 'package.json');

    const [hasPnpmWorkspace, hasTurbo, packageJsonContent] = await Promise.all([
      this.fileExists(pnpmWorkspacePath),
      this.fileExists(turboJsonPath),
      this.readFile(packageJsonPath),
    ]);

    let packageManager: PackageManager = 'npm'; // Default to npm
    if (hasPnpmWorkspace) {
      packageManager = 'pnpm';
    } else {
      // Basic fallback detection
      if (await this.fileExists(path.join(rootPath, 'yarn.lock'))) {
        packageManager = 'yarn';
      } else if (await this.fileExists(path.join(rootPath, 'package-lock.json'))) {
        packageManager = 'npm';
      }
    }

    let pkg: Record<string, unknown> = {};
    if (packageJsonContent) {
      try {
        pkg = JSON.parse(packageJsonContent) as Record<string, unknown>;
      } catch {
        // Malformed package.json - use empty object as fallback
      }
    }
    const scripts = isRecord(pkg.scripts) ? pkg.scripts : {};

    const scriptAvailability = {
      test: typeof scripts.test === 'string' && scripts.test.trim().length > 0,
      lint: typeof scripts.lint === 'string' && scripts.lint.trim().length > 0,
      typecheck: typeof scripts.typecheck === 'string' && scripts.typecheck.trim().length > 0,
    };

    const commands: ToolchainCommands = {};

    if (packageManager === 'pnpm') {
      // Test Command
      if (hasTurbo && scriptAvailability.test) {
        commands.testCmd = 'pnpm turbo run test';
      } else if (scriptAvailability.test) {
        commands.testCmd = 'pnpm test';
      } else {
        commands.testCmd = 'pnpm -r test';
      }

      // Lint Command
      if (hasTurbo && scriptAvailability.lint) {
        commands.lintCmd = 'pnpm turbo run lint';
      } else if (scriptAvailability.lint) {
        commands.lintCmd = 'pnpm lint';
      } else {
        commands.lintCmd = 'pnpm -r lint';
      }

      // Typecheck Command
      if (hasTurbo && scriptAvailability.typecheck) {
        commands.typecheckCmd = 'pnpm turbo run typecheck';
      } else if (scriptAvailability.typecheck) {
        commands.typecheckCmd = 'pnpm typecheck';
      } else {
        commands.typecheckCmd = 'pnpm -r typecheck';
      }
    } else {
      // Fallback for non-pnpm (not explicitly detailed in spec heuristics but good to have basics)
      // The spec explicitly focuses on pnpm monorepo.
      // We will leave commands empty or undefined if not pnpm,
      // or maybe just map root scripts if they exist.
      if (scriptAvailability.test) {
        commands.testCmd =
          packageManager === 'npm' || packageManager === 'yarn'
            ? `${packageManager} test`
            : `${packageManager} run test`;
      }
      if (scriptAvailability.lint) commands.lintCmd = `${packageManager} run lint`;
      if (scriptAvailability.typecheck) commands.typecheckCmd = `${packageManager} run typecheck`;
    }

    return {
      packageManager,
      usesTurbo: hasTurbo,
      scripts: scriptAvailability,
      commands,
    };
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private async readFile(filePath: string): Promise<string | null> {
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch {
      return null;
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
