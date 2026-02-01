import { describe, test, expect, vi, beforeEach } from 'vitest';
import { SafeCommandRunner, UserInterface, RunnerContext } from './runner';
import { ToolRunRequest, ToolPolicy, UsageError } from '@orchestrator/shared';
import { ConfirmationDeniedError } from './errors';

describe('SafeCommandRunner Flags', () => {
  let runner: SafeCommandRunner;
  let mockUi: UserInterface;
  let ctx: RunnerContext;

  const defaultPolicy: ToolPolicy = {
    enabled: true,
    requireConfirmation: true,
    allowlistPrefixes: ['ls'],
    denylistPatterns: ['rm -rf'],
    allowNetwork: false,
    timeoutMs: 1000,
    maxOutputBytes: 1024,
    autoApprove: false,
    interactive: true,
  };

  beforeEach(() => {
    runner = new SafeCommandRunner();
    mockUi = {
      confirm: vi.fn().mockResolvedValue(true),
    };
    ctx = { runId: 'test-run', toolRunId: 'tool-1', cwd: process.cwd() };
  });

  test('should deny execution when enabled is false', async () => {
    const policy = { ...defaultPolicy, enabled: false };
    const req: ToolRunRequest = { command: 'ls', reason: 'test', cwd: '/tmp' };

    await expect(runner.run(req, policy, mockUi, ctx)).rejects.toThrow(
      'Tool execution is disabled',
    );
  });

  test('should skip confirmation when autoApprove is true', async () => {
    const policy = { ...defaultPolicy, requireConfirmation: true, autoApprove: true };
    const req: ToolRunRequest = { command: 'echo hello', reason: 'test', cwd: '/tmp' }; // Not allowlisted

    // Subclass and mock exec
    class MockRunner extends SafeCommandRunner {
      protected async exec() {
        return { exitCode: 0, durationMs: 0, stdoutPath: '', stderrPath: '', truncated: false };
      }
    }
    const mockRunner = new MockRunner();

    await mockRunner.run(req, policy, mockUi, ctx);
    expect(mockUi.confirm).not.toHaveBeenCalled();
  });

  test('should throw UsageError in non-interactive mode when confirmation is needed', async () => {
    const policy = { ...defaultPolicy, requireConfirmation: true, interactive: false };
    const req: ToolRunRequest = { command: 'echo hello', reason: 'test', cwd: '/tmp' }; // Not allowlisted

    await expect(runner.run(req, policy, mockUi, ctx)).rejects.toThrow(UsageError);
    expect(mockUi.confirm).not.toHaveBeenCalled();
  });

  test('should allow execution in non-interactive mode when confirmation is NOT needed', async () => {
    const policy = { ...defaultPolicy, requireConfirmation: true, interactive: false };
    const req: ToolRunRequest = { command: 'ls', reason: 'test', cwd: '/tmp' }; // Allowlisted

    class MockRunner extends SafeCommandRunner {
      protected async exec() {
        return { exitCode: 0, durationMs: 0, stdoutPath: '', stderrPath: '', truncated: false };
      }
    }
    const mockRunner = new MockRunner();

    await mockRunner.run(req, policy, mockUi, ctx);
    expect(mockUi.confirm).not.toHaveBeenCalled();
  });

  test('should still deny denylisted commands even with autoApprove', async () => {
    const policy = { ...defaultPolicy, autoApprove: true, denylistPatterns: ['rm'] };
    const req: ToolRunRequest = { command: 'rm file', reason: 'test', cwd: '/tmp' };

    await expect(runner.run(req, policy, mockUi, ctx)).rejects.toThrow(/denylist/);
  });
});
