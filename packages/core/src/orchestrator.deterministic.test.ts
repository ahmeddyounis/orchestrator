import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs/promises';
import { execSync } from 'child_process';
import { Orchestrator } from './orchestrator';
import { ProviderRegistry } from './registry';
import { GitService } from '@orchestrator/repo';
import { Config, ConfigSchema } from '@orchestrator/shared';
import { SubprocessProviderAdapter } from '@orchestrator/adapters';
import { tmpdir } from 'node:os';

// Helper to copy recursively
async function copyDir(src: string, dest: string) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

const FIXTURE_SRC = path.resolve(__dirname, '../../repo/src/__fixtures__/ts-monorepo');
const CLI_PATH = path.resolve(__dirname, '__fixtures__/fake-diff-cli.js');

describe('Orchestrator Deterministic E2E', () => {
  let testRoot: string;

  beforeAll(async () => {
    testRoot = await fs.mkdtemp(path.join(tmpdir(), 'orchestrator-e2e-test-'));
    // Setup temp fixture
    await copyDir(FIXTURE_SRC, testRoot);

    // Init git
    execSync('git init', { cwd: testRoot });
    execSync('git config user.email "test@example.com"', { cwd: testRoot });
    execSync('git config user.name "Test User"', { cwd: testRoot });
    // Ignore .orchestrator to prevent git status pollution
    await fs.writeFile(path.join(testRoot, '.gitignore'), '.orchestrator/\n');

    // Create a target file with known content to avoid context mismatch issues
    await fs.writeFile(
      path.join(testRoot, 'packages/a/src/target.ts'),
      'export const value = 1;\n',
    );
    await fs.writeFile(
      path.join(testRoot, 'packages/b/src/target.ts'),
      'export const value = 1;\n',
    );

    execSync('git add .', { cwd: testRoot });
    execSync('git commit -m "Initial commit"', { cwd: testRoot });
  });

  afterAll(async () => {
    // Cleanup
    await fs.rm(testRoot, { recursive: true, force: true });
  });

  beforeEach(() => {
    // Ensure clean state
    try {
      execSync('git reset --hard HEAD', { cwd: testRoot });
      execSync('git clean -fd', { cwd: testRoot });
    } catch (e) {
      // Ignore if git not init yet (first run)
    }
  });

  it('L0: applies simple diff via fake CLI', async () => {
    // Setup Registry with Fake CLI
    const config: Config = {
      verification: {} as any,
      configVersion: 1,
      thinkLevel: 'L0',
      memory: ConfigSchema.parse({}).memory,
      defaults: { executor: 'fake-cli' },
      providers: {
        'fake-cli': {
          type: 'subprocess',
          command: ['node', CLI_PATH], // Call the fake CLI
        } as any,
      },
    };

    const registry = new ProviderRegistry(config);
    registry.registerFactory('subprocess', (cfg) => new SubprocessProviderAdapter(cfg as any));

    const git = new GitService({ repoRoot: testRoot });
    const orchestrator = new Orchestrator({
      config,
      git,
      registry,
      repoRoot: testRoot,
    });

    const result = await orchestrator.runL0('L0_GOAL: Fix the bug', 'run-l0-test');

    expect(result.status).toBe('success');
    expect(result.patchPaths?.length).toBe(2);
    expect(result.patchPaths?.[1]?.replace(/\\/g, '/')).toContain('patches/final.diff.patch');

    // Verify file content
    const content = await fs.readFile(path.join(testRoot, 'packages/a/src/target.ts'), 'utf-8');
    expect(content).toContain('value = 2');
  }, 20000);

  it('L1: executes multi-step plan via fake CLI', async () => {
    const config: Config = {
      verification: {} as any,
      configVersion: 1,
      thinkLevel: 'L1',
      memory: ConfigSchema.parse({}).memory,
      defaults: {
        planner: 'fake-planner',
        executor: 'fake-executor',
        reviewer: 'fake-executor',
      },
      providers: {
        'fake-planner': {
          type: 'subprocess',
          command: ['node', CLI_PATH],
        } as any,
        'fake-executor': {
          type: 'subprocess',
          command: ['node', CLI_PATH],
        } as any,
      },
    };

    const registry = new ProviderRegistry(config);
    registry.registerFactory('subprocess', (cfg) => new SubprocessProviderAdapter(cfg as any));

    const git = new GitService({ repoRoot: testRoot });
    const orchestrator = new Orchestrator({
      config,
      git,
      registry,
      repoRoot: testRoot,
    });

    const result = await orchestrator.runL1('L1_GOAL: Complex change', 'run-l1-test');

    expect(result.status).toBe('success');

    // Check Step 1 change
    const contentA = await fs.readFile(path.join(testRoot, 'packages/a/src/target.ts'), 'utf-8');
    expect(contentA).toContain('value = 2');

    const contentB = await fs.readFile(path.join(testRoot, 'packages/b/src/target.ts'), 'utf-8');
    expect(contentB).toContain('value = 2');
  }, 20000);

  it('L1: rollback on failure', async () => {
    const config: Config = {
      verification: {} as any,
      configVersion: 1,
      thinkLevel: 'L1',
      memory: ConfigSchema.parse({}).memory,
      defaults: {
        planner: 'fake-planner',
        executor: 'fake-executor',
        reviewer: 'fake-executor',
      },
      providers: {
        'fake-planner': {
          type: 'subprocess',
          command: ['node', CLI_PATH],
        } as any,
        'fake-executor': {
          type: 'subprocess',
          command: ['node', CLI_PATH],
        } as any,
      },
    };

    const registry = new ProviderRegistry(config);
    registry.registerFactory('subprocess', (cfg) => new SubprocessProviderAdapter(cfg as any));

    const git = new GitService({ repoRoot: testRoot });
    const orchestrator = new Orchestrator({
      config,
      git,
      registry,
      repoRoot: testRoot,
    });

    // Make sure we have a clean state before run
    execSync('git reset --hard HEAD', { cwd: testRoot });

    const result = await orchestrator.runL1('L1_GOAL FAILURE_GOAL', 'run-l1-fail');

    expect(result.status).toBe('failure');

    // Verify rollback (file should be clean)
    // We can check git status
    const status = execSync('git status --porcelain', { cwd: testRoot }).toString();
    expect(status).toBe('');
  }, 20000);
});
