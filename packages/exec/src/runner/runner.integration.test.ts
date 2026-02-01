import { describe, it, expect, afterAll } from 'vitest';
import { SafeCommandRunner, UserInterface, RunnerContext } from './runner';
import { ToolRunRequest, ToolPolicy, ToolError, UsageError } from '@orchestrator/shared';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

describe('SafeCommandRunner Integration', () => {
  const runner = new SafeCommandRunner();
  const mockUi: UserInterface = {
    confirm: async () => true, // Always confirm for these tests if asked
  };

  // Use a unique run ID for this test suite to avoid conflicts
  const testRunId = `integration-test-${randomUUID()}`;
  const mockCtx: RunnerContext = {
    runId: testRunId,
    cwd: process.cwd(),
  };

  const projectRoot = process.cwd();
  const runsDir = path.join(projectRoot, '.orchestrator', 'runs', testRunId);

  // Default policy: fairly restrictive but allows what we need
  const basePolicy: ToolPolicy = {
    enabled: true,
    requireConfirmation: false,
    allowlistPrefixes: [],
    denylistPatterns: [],
    allowNetwork: false,
    timeoutMs: 5000,
    maxOutputBytes: 1024 * 1024,
    interactive: false, // Assume non-interactive for automation
  };

  afterAll(() => {
    // Cleanup the test run directory
    if (fs.existsSync(runsDir)) {
      fs.rmSync(runsDir, { recursive: true, force: true });
    }
  });

  it('should execute an allowlisted command and capture output', async () => {
    // allowlistPrefixes: ['node']
    const policy: ToolPolicy = {
      ...basePolicy,
      allowlistPrefixes: ['node'],
    };

    const req: ToolRunRequest = {
      command: 'node packages/exec/src/runner/test-script.js',
      reason: 'Integration test allowlist',
      cwd: process.cwd(),
    };

    const result = await runner.run(req, policy, mockUi, mockCtx);

    expect(result.exitCode).toBe(0);
    // Read the stdout file
    const stdoutContent = fs.readFileSync(result.stdoutPath, 'utf8');
    expect(stdoutContent).toContain('SAFE_123');
  });

  it('should block a denylisted command', async () => {
    const policy: ToolPolicy = {
      ...basePolicy,
      denylistPatterns: ['forbidden'],
    };

    const req: ToolRunRequest = {
      command: 'echo "this is forbidden"',
      reason: 'Integration test denylist',
      cwd: process.cwd(),
    };

    await expect(runner.run(req, policy, mockUi, mockCtx)).rejects.toThrow(UsageError);
  });

  it('should timeout if command takes too long', async () => {
    const policy: ToolPolicy = {
      ...basePolicy,
      timeoutMs: 1000, // 1 second timeout
      allowlistPrefixes: ['node'],
    };

    // Run for 3 seconds
    const req: ToolRunRequest = {
      command: "node packages/exec/src/runner/test-timeout-script.js",
      reason: 'Integration test timeout',
      cwd: process.cwd(),
    };

    await expect(runner.run(req, policy, mockUi, mockCtx)).rejects.toThrow(ToolError);
  });
});
