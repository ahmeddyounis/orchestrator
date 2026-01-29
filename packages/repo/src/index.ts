import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Finds the repository root starting from the current directory.
 * Heuristics:
 * 1. Nearest parent containing .git
 * 2. Nearest parent containing pnpm-workspace.yaml
 * 3. Nearest parent containing package.json with "workspaces" property
 *
 * Validates that .orchestrator directory can be created in the found root.
 */
export async function findRepoRoot(cwd: string = process.cwd()): Promise<string> {
  const root = path.parse(cwd).root;
  let currentDir = path.resolve(cwd);

  while (true) {
    if (await isRepoRoot(currentDir)) {
      await validateRepoRoot(currentDir);
      return currentDir;
    }

    if (currentDir === root) {
      break;
    }
    currentDir = path.dirname(currentDir);
  }

  throw new Error(
    `Could not detect repository root from ${cwd}. Ensure you are inside a git repository or a monorepo root.`,
  );
}

async function isRepoRoot(dir: string): Promise<boolean> {
  // 1. Check for .git
  try {
    await fs.access(path.join(dir, '.git'));
    return true;
  } catch {
    // ignore
  }

  // 2. Check for pnpm-workspace.yaml
  try {
    await fs.access(path.join(dir, 'pnpm-workspace.yaml'));
    return true;
  } catch {
    // ignore
  }

  // 3. Check for package.json with workspaces
  try {
    const pkgPath = path.join(dir, 'package.json');
    const content = await fs.readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(content);
    if (pkg.workspaces) {
      return true;
    }
  } catch {
    // ignore
  }

  return false;
}

async function validateRepoRoot(dir: string): Promise<void> {
  const orchestratorDir = path.join(dir, '.orchestrator');
  try {
    await fs.mkdir(orchestratorDir, { recursive: true });
    await fs.access(orchestratorDir, fs.constants.W_OK);
  } catch (error) {
    throw new Error(
      `Repository root detected at ${dir}, but cannot write to .orchestrator directory: ${(error as Error).message}`,
    );
  }
}
