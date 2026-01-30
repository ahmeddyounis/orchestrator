import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs/promises';
import { execSync } from 'child_process';
import { Orchestrator } from './orchestrator';
import { ProviderRegistry } from './registry';
import { GitService } from '@orchestrator/repo';
import { Config, ConfigSchema } from '@orchestrator/shared';
import { SubprocessProviderAdapter } from '@orchestrator/adapters';

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
// Use a unique path for the test execution to avoid conflicts
const TEST_ROOT = path.resolve(process.cwd(), '.tmp', '__tmp_test_env_' + Date.now());
const CLI_PATH = path.resolve(__dirname, '__fixtures__/fake-diff-cli.js');

describe('Orchestrator Deterministic E2E', () => {
  beforeAll(async () => {
    // Setup temp fixture
    await copyDir(FIXTURE_SRC, TEST_ROOT);

    // Init git
    execSync('git init', { cwd: TEST_ROOT });
    execSync('git config user.email "test@example.com"', { cwd: TEST_ROOT });
    execSync('git config user.name "Test User"', { cwd: TEST_ROOT });
    // Ignore .orchestrator to prevent git status pollution
    await fs.writeFile(path.join(TEST_ROOT, '.gitignore'), '.orchestrator/\n');

    // Create a target file with known content to avoid context mismatch issues
    await fs.writeFile(
      path.join(TEST_ROOT, 'packages/a/src/target.ts'),
      'export const value = 1;\n',
    );
    await fs.writeFile(
      path.join(TEST_ROOT, 'packages/b/src/target.ts'),
      'export const value = 1;\n',
    );

    execSync('git add .', { cwd: TEST_ROOT });
    execSync('git commit -m "Initial commit"', { cwd: TEST_ROOT });
  });

  afterAll(async () => {
    // Cleanup
    await fs.rm(TEST_ROOT, { recursive: true, force: true });
  });

  beforeEach(() => {
    // Ensure clean state
    try {
      execSync('git reset --hard HEAD', { cwd: TEST_ROOT });
      execSync('git clean -fd', { cwd: TEST_ROOT });
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

    const git = new GitService({ repoRoot: TEST_ROOT });
    const orchestrator = new Orchestrator({
      config,
      git,
      registry,
      repoRoot: TEST_ROOT,
    });

    const result = await orchestrator.runL0('L0_GOAL: Fix the bug', 'run-l0-test');

    expect(result.status).toBe('success');
    expect(result.patchPaths?.length).toBe(1);

    // Verify file content
    const content = await fs.readFile(path.join(TEST_ROOT, 'packages/a/src/target.ts'), 'utf-8');
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

    const git = new GitService({ repoRoot: TEST_ROOT });
    const orchestrator = new Orchestrator({
      config,
      git,
      registry,
      repoRoot: TEST_ROOT,
    });

    const result = await orchestrator.runL1('L1_GOAL: Complex change', 'run-l1-test');

    expect(result.status).toBe('success');

    // Check Step 1 change
    const contentA = await fs.readFile(path.join(TEST_ROOT, 'packages/a/src/target.ts'), 'utf-8');
    expect(contentA).toContain('value = 2');

    const contentB = await fs.readFile(path.join(TEST_ROOT, 'packages/b/src/target.ts'), 'utf-8');
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

    const git = new GitService({ repoRoot: TEST_ROOT });
    const orchestrator = new Orchestrator({
      config,
      git,
      registry,
      repoRoot: TEST_ROOT,
    });

    // Make sure we have a clean state before run
    execSync('git reset --hard HEAD', { cwd: TEST_ROOT });

    const result = await orchestrator.runL1('L1_GOAL FAILURE_GOAL', 'run-l1-fail');

    expect(result.status).toBe('failure');

    // Verify rollback (file should be clean)
    // We can check git status
    const status = execSync('git status --porcelain', { cwd: TEST_ROOT }).toString();
    expect(status).toBe('');
  }, 20000);
});
