import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs/promises';
import { execSync } from 'child_process';

import { Orchestrator } from './orchestrator';
import { type ProviderAdapter, ProviderCapabilities } from '@orchestrator/adapters';
import { ProviderRegistry } from './registry';
import { type AgentContext, type AgentResponse, type AgentTask, type Verification } from './types';
import { Config, ConfigSchema } from '@orchestrator/shared';
import { GitService } from '@orchestrator/repo';

vi.mock('@orchestrator/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@orchestrator/shared')>();
  return {
    ...actual,
    createRunDir: vi.fn(),
  };
});

const TEST_TIMEOUT = 30_000;
const FIXTURE_REPO_DIR = path.resolve(__dirname, '..', '..', '..', 'demos', 'ts-monorepo-demo');

// A diff that is not in the correct format
const invalidDiff = `
This is not a valid diff.
`;

// A diff that applies but results in failing tests
const testFailingDiff = `
--- a/packages/package-a/src/index.ts
+++ b/packages/package-a/src/index.ts
@@ -1,5 +1,5 @@
 import { add } from 'package-b';
 
 export function myFunc(a: number, b: number): number {
-  return add(a, b);
+  return a * b; // This will fail the test which expects 1+2=4 (but gets 1*2=2)
 }
`;

// A diff that applies and passes tests
const testPassingDiff = `
--- a/packages/package-a/src/index.test.ts
+++ b/packages/package-a/src/index.test.ts
@@ -2,5 +2,5 @@
 import { expect, test } from 'vitest';
 
 test('myFunc', () => {
-  expect(myFunc(1, 2)).toBe(4);
+  expect(myFunc(1, 2)).toBe(3);
 });
`;

class FakeMultiCandidateExecutor implements ProviderAdapter {
  private responses: string[];
  private callCount = 0;

  constructor(responses: string[]) {
    this.responses = responses.map(
      (r) => `BEGIN_DIFF
${r.trim()}
END_DIFF`,
    );
  }

  get name(): string {
    return 'fake-multi-candidate-executor';
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

  async generate(task: AgentTask, context: AgentContext): Promise<AgentResponse> {
    if (this.callCount >= this.responses.length) {
      // Best-of-N will stop requesting when it hits the budget cap,
      // but if it requests more, we throw.
      throw new Error(
        `FakeMultiCandidateExecutor asked for more responses than configured: got ${
          this.callCount + 1
        }, expected ${this.responses.length}`,
      );
    }
    const responseText = this.responses[this.callCount++];
    return { text: responseText };
  }
}

class FakeReviewer implements ProviderAdapter {
  private review: object;
  public callCount = 0;

  constructor(review: object = {}) {
    this.review = review;
  }

  get name(): string {
    return 'fake-reviewer';
  }

  capabilities(): ProviderCapabilities {
    return {
      supportsStreaming: false,
      supportsToolCalling: false,
      supportsJsonMode: true,
      modality: 'text',
      latencyClass: 'fast',
    };
  }

  async generate(task: AgentTask, context: AgentContext): Promise<AgentResponse> {
    this.callCount++;
    return { text: JSON.stringify(this.review) };
  }
}

describe('Orchestrator L3 Deterministic Tests', () => {
  let workDir: string;
  let verification: Verification;
  let git: GitService;

  beforeEach(async () => {
    const testSessionDir = path.resolve(process.cwd(), '.tmp/l3-tests');
    await fs.mkdir(testSessionDir, { recursive: true });
    workDir = await fs.mkdtemp(path.join(testSessionDir, 'orchestrator-l3-determ-test-'));
    await fs.cp(FIXTURE_REPO_DIR, workDir, { recursive: true });

    execSync('git init', { cwd: workDir });
    execSync('git config user.email "test@example.com"', { cwd: workDir });
    execSync('git config user.name "Test User"', { cwd: workDir });
    execSync('git add .', { cwd: workDir });
    execSync('git commit -m "Initial commit"', { cwd: workDir });

    git = new GitService({ repoRoot: workDir });

    verification = {
      test: {
        command: 'pnpm',
        args: ['--filter', 'package-a', 'test'],
        env: { CI: 'true' },
        parser: {
          success: '1 passed',
          failure: 'fail',
        },
      },
      typecheck: {
        command: 'pnpm',
        args: ['typecheck'],
      },
    };
  });

  afterEach(async () => {
    await fs.rm(workDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it(
    'best-of-N: selection chooses the first valid candidate that passes tests',
    async () => {
      const runId = 'test-run-l3';
      const { createRunDir } = await import('@orchestrator/shared');
      (createRunDir as ReturnType<typeof vi.fn>).mockResolvedValue({
        root: path.join(workDir, '.orchestrator', 'runs', runId),
        trace: path.join(workDir, '.orchestrator', 'runs', runId, 'trace.jsonl'),
        summary: path.join(workDir, '.orchestrator', 'runs', runId, 'summary.json'),
        manifest: path.join(workDir, '.orchestrator', 'runs', runId, 'manifest.json'),
        patchesDir: path.join(workDir, '.orchestrator', 'runs', runId, 'patches'),
        toolLogsDir: path.join(workDir, '.orchestrator', 'runs', runId, 'tool_logs'),
      });

      const multiExecutor = new FakeMultiCandidateExecutor([
        invalidDiff,
        testFailingDiff,
        testPassingDiff,
      ]);
      const reviewer = new FakeReviewer();

      const config: Config = {
        configVersion: 1,
        thinkLevel: 'L3',
        memory: ConfigSchema.parse({}).memory,
        defaults: {
          planner: 'fake-multi',
          executor: 'fake-multi',
          reviewer: 'fake-reviewer',
        },
        providers: {
          'fake-multi': { type: 'fake-multi', model: 'fake' },
          'fake-reviewer': { type: 'fake-reviewer', model: 'fake' },
        },
        verification: {
          enabled: true,
          mode: 'custom',
          steps: [
            { name: 'pnpm typecheck', command: 'pnpm typecheck' },
            { name: 'pnpm test', command: 'pnpm test' },
          ],
          auto: {
            enableLint: false,
            enableTests: true,
            enableTypecheck: true,
            testScope: 'targeted',
          },
        },
        execution: {
          bestOfN: 3,
          earlyExit: true,
        },
      };

      const registry = new ProviderRegistry(config);
      registry.registerFactory('fake-multi', () => multiExecutor);
      registry.registerFactory('fake-reviewer', () => reviewer);

      const orchestrator = new Orchestrator({
        config,
        git,
        registry,
        repoRoot: workDir,
        ui: { confirm: async () => true },
        toolPolicy: {
          enabled: true,
          requireConfirmation: false,
          autoApprove: true,
          allowlistPrefixes: ['pnpm'],
          denylistPatterns: [],
          interactive: false,
          timeoutMs: 30000,
          maxOutputBytes: 1024 * 1024,
        },
      });

      const goal = 'Fix the test: The test in package-a is failing. Please fix it.';
      const result = await orchestrator.run(goal, { thinkLevel: 'L3', runId });

      expect(result.status).toBe('success');
      expect(result.summary).toContain('L3 verification passed');
      expect(multiExecutor['callCount']).toBe(3); // All 3 candidates were tried
      expect(reviewer.callCount).toBe(0); // Reviewer should not be called
    },
    TEST_TIMEOUT,
  );
});
