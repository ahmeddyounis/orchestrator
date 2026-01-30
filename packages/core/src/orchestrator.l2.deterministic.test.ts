import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Orchestrator } from './orchestrator';
import { ProviderRegistry } from './registry';
import { Config, ConfigSchema, ProviderCapabilities, ToolPolicy } from '@orchestrator/shared';
import { GitService } from '@orchestrator/repo';

vi.mock('@orchestrator/repo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@orchestrator/repo')>();
  return {
    ...actual,
    GitService: class extends actual.GitService {
      async rollbackToCheckpoint(): Promise<void> {
        // No-op for deterministic tests; avoids git clean removing run artifacts.
      }
    },
  };
});
import path from 'path';
import fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
import { UserInterface } from '@orchestrator/exec';
import { ProviderAdapter } from '@orchestrator/adapters';
import { VerificationRunner } from './verify/runner';
import type { VerificationReport } from './verify/types';

const execAsync = promisify(exec);

const FIXTURES_DIR = path.resolve(__dirname, '../../repo/src/__fixtures__');
const TEMP_DIR = path.resolve(__dirname, '../../../../.tmp/l2-tests');

async function copyDirectory(src: string, dest: string) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isSymbolicLink()) {
      continue;
    } else if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

class FakeExecutor implements ProviderAdapter {
  private responses: string[];
  private callCount = 0;

  constructor(responses: string[]) {
    this.responses = responses;
  }

  id() {
    return 'fake-executor';
  }

  capabilities(): ProviderCapabilities {
    return {
      supportsStreaming: false,
      supportsToolCalling: false,
      supportsJsonMode: false,
      modality: 'text',
      latencyClass: 'fast',
    };
  }

  async generate(request: any) {
    // For planning requests (jsonMode), return a simple plan
    if (request.jsonMode || request.messages?.[0]?.content?.includes('architecture planner')) {
      return { text: '{"steps": ["Step 1: Apply fix"]}' };
    }

    // For execution requests, return the diff
    const response = this.responses[this.callCount % this.responses.length];
    this.callCount++;
    return { text: response };
  }
}

describe('Orchestrator L2 Deterministic', () => {
  let testRepoPath: string;
  let runId: string;

  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
    runId = `test-run-${Date.now()}`;
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  async function setupTestRepo(fixtureName: string) {
    testRepoPath = path.join(TEMP_DIR, fixtureName);
    const fixturePath = path.join(FIXTURES_DIR, fixtureName);
    await copyDirectory(fixturePath, testRepoPath);

    await execAsync('git init', { cwd: testRepoPath });
    await execAsync('git config user.email "test@example.com"', { cwd: testRepoPath });
    await execAsync('git config user.name "Test User"', { cwd: testRepoPath });
    await execAsync('git add .', { cwd: testRepoPath });
    await execAsync('git commit -m "Initial commit"', { cwd: testRepoPath });
  }

  const baseConfig: Config = {
    configVersion: 1,
    thinkLevel: 'L2',
    memory: ConfigSchema.parse({}).memory,
    defaults: {
      planner: 'fake-executor',
      executor: 'fake-executor',
      reviewer: 'fake-executor',
    },
    providers: {
      'fake-executor': { type: 'fake-executor', model: 'fake' },
    },
    verification: {
      enabled: true,
      mode: 'custom',
      steps: [],
      auto: {
        enableLint: false,
        enableTypecheck: false,
        enableTests: false,
        testScope: 'targeted',
        maxCommandsPerIteration: 1,
      },
    },
    patch: {
      maxFilesChanged: 10,
      maxLinesChanged: 100,
      allowBinary: false,
    },
  };

  const toolPolicy: ToolPolicy = {
    enabled: true,
    requireConfirmation: false,
    allowlistPrefixes: ['npm', 'vitest'],
    denylistPatterns: [],
    allowNetwork: true,
    timeoutMs: 60000,
    maxOutputBytes: 1024 * 1024,
    autoApprove: true,
    interactive: false,
  };

  it('should run L2 and fix a typecheck error', async () => {
    await setupTestRepo('ts-monorepo-failing-typecheck');

    const typecheckFixDiff = [
      'diff --git a/src/index.ts b/src/index.ts',
      '--- a/src/index.ts',
      '+++ b/src/index.ts',
      '@@ -4,3 +4,3 @@ function greeter(name: string) {',
      ' ',
      "-const x: number = 'not a number';",
      '+const x: number = 0;',
      ' ',
    ].join('\n');

    const config: Config = {
      ...baseConfig,
      verification: {
        enabled: true,
        mode: 'custom',
        steps: [],
        auto: {
          enableLint: false,
          enableTypecheck: false,
          enableTests: false,
          testScope: 'targeted',
          maxCommandsPerIteration: 1,
        },
      },
    };

    const mockRegistry = new ProviderRegistry(config);
    mockRegistry.registerFactory(
      'fake-executor',
      () => new FakeExecutor([`BEGIN_DIFF\n\n${typecheckFixDiff}\nEND_DIFF`]),
    );

    let verifyCallCount = 0;
    const failedReport: VerificationReport = {
      passed: false,
      checks: [
        {
          name: 'typecheck',
          command: 'npm run typecheck',
          exitCode: 1,
          durationMs: 100,
          stdoutPath: '',
          stderrPath: '',
          passed: false,
        },
      ],
      summary: 'Typecheck failed',
      failureSignature: 'sig1',
    };
    const passedReport: VerificationReport = {
      passed: true,
      checks: [],
      summary: 'All checks passed',
    };

    vi.spyOn(VerificationRunner.prototype, 'run').mockImplementation(async () => {
      verifyCallCount++;
      // First call (after L1): fail, second call (after repair): pass
      return verifyCallCount === 1 ? failedReport : passedReport;
    });

    const orchestrator = new Orchestrator({
      config,
      git: new GitService({ repoRoot: testRepoPath }),
      registry: mockRegistry,
      repoRoot: testRepoPath,
      ui: { confirm: () => Promise.resolve(true) } as UserInterface,
      toolPolicy,
    });

    const result = await orchestrator.runL2('Fix the type error', runId);

    expect(result.status).toBe('success');
    expect(result.summary).toContain('L2 Verified Success after 1 iterations');
    expect(result.verification?.passed).toBe(true);
    const fixedFileContent = await fs.readFile(path.join(testRepoPath, 'src/index.ts'), 'utf-8');
    expect(fixedFileContent).toContain('const x: number = 0;');

    vi.restoreAllMocks();
  }, 30000);

  it('should run L2 and fix a failing test', async () => {
    await setupTestRepo('ts-monorepo-failing-test');

    const testFixDiff = [
      'diff --git a/src/index.test.ts b/src/index.test.ts',
      '--- a/src/index.test.ts',
      '+++ b/src/index.test.ts',
      "@@ -2,5 +2,5 @@ import { test, expect } from 'vitest';",
      " import { add } from './index';",
      ' ',
      " test('adds two numbers', () => {",
      '-  expect(add(1, 2)).toBe(4); // This will fail',
      '+  expect(add(1, 2)).toBe(3);',
      ' });',
    ].join('\n');

    const config: Config = {
      ...baseConfig,
      verification: {
        enabled: true,
        mode: 'custom',
        steps: [],
        auto: {
          enableLint: false,
          enableTypecheck: false,
          enableTests: false,
          testScope: 'targeted',
          maxCommandsPerIteration: 1,
        },
      },
    };

    const mockRegistry = new ProviderRegistry(config);
    mockRegistry.registerFactory(
      'fake-executor',
      () => new FakeExecutor([`BEGIN_DIFF\n${testFixDiff}\nEND_DIFF`]),
    );

    let verifyCallCount = 0;
    const failedReport: VerificationReport = {
      passed: false,
      checks: [
        {
          name: 'test',
          command: 'npm run test',
          exitCode: 1,
          durationMs: 100,
          stdoutPath: '',
          stderrPath: '',
          passed: false,
        },
      ],
      summary: 'Tests failed',
      failureSignature: 'sig2',
    };
    const passedReport: VerificationReport = {
      passed: true,
      checks: [],
      summary: 'All checks passed',
    };

    vi.spyOn(VerificationRunner.prototype, 'run').mockImplementation(async () => {
      verifyCallCount++;
      return verifyCallCount === 1 ? failedReport : passedReport;
    });

    const orchestrator = new Orchestrator({
      config,
      git: new GitService({ repoRoot: testRepoPath }),
      registry: mockRegistry,
      repoRoot: testRepoPath,
      ui: { confirm: () => Promise.resolve(true) } as UserInterface,
      toolPolicy,
    });

    const result = await orchestrator.runL2('Fix the test failure', runId);

    expect(result.status).toBe('success');
    expect(result.summary).toContain('L2 Verified Success after 1 iterations');
    expect(result.verification?.passed).toBe(true);
    const fixedFileContent = await fs.readFile(
      path.join(testRepoPath, 'src/index.test.ts'),
      'utf-8',
    );
    expect(fixedFileContent).toContain('expect(add(1, 2)).toBe(3);');

    vi.restoreAllMocks();
  }, 30000);

  it('should stop if verification keeps failing with same signature', async () => {
    await setupTestRepo('ts-monorepo-failing-typecheck');

    const nonFixingDiff = [
      'diff --git a/src/index.ts b/src/index.ts',
      '--- a/src/index.ts',
      '+++ b/src/index.ts',
      '@@ -1,3 +1,3 @@',
      '-function greeter(name: string) {',
      '+function greeter(name: string) { // comment change',
      '   return `Hello, ${name}`;',
      ' }',
    ].join('\n');

    const config: Config = {
      ...baseConfig,
      verification: {
        enabled: true,
        mode: 'custom',
        steps: [],
        auto: {
          enableLint: false,
          enableTypecheck: false,
          enableTests: false,
          testScope: 'targeted',
          maxCommandsPerIteration: 1,
        },
      },
    };

    const mockRegistry = new ProviderRegistry(config);
    mockRegistry.registerFactory(
      'fake-executor',
      () => new FakeExecutor([`BEGIN_DIFF\n${nonFixingDiff}\nEND_DIFF`]),
    );

    const failedReport: VerificationReport = {
      passed: false,
      checks: [
        {
          name: 'typecheck',
          command: 'npm run typecheck',
          exitCode: 1,
          durationMs: 100,
          stdoutPath: '',
          stderrPath: '',
          passed: false,
        },
      ],
      summary: 'Typecheck failed',
      failureSignature: 'sig_same',
    };

    // Always return the same failure signature
    vi.spyOn(VerificationRunner.prototype, 'run').mockResolvedValue(failedReport);

    const orchestrator = new Orchestrator({
      config,
      git: new GitService({ repoRoot: testRepoPath }),
      registry: mockRegistry,
      repoRoot: testRepoPath,
      ui: { confirm: () => Promise.resolve(true) } as UserInterface,
      toolPolicy,
    });

    const result = await orchestrator.runL2('Fix the type error', runId);

    expect(result.status).toBe('failure');
    expect(result.stopReason).toBe('non_improving');
    expect(result.verification?.passed).toBe(false);
    const finalFileContent = await fs.readFile(path.join(testRepoPath, 'src/index.ts'), 'utf-8');
    expect(finalFileContent).toContain("const x: number = 'not a number';");

    vi.restoreAllMocks();
  }, 30000);
});
