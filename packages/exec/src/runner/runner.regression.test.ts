import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { SafeCommandRunner, UserInterface, RunnerContext } from './runner';
import { ToolPolicy, ToolRunRequest } from '@orchestrator/shared';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import * as fs from 'fs';

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    default: {
      ...actual,
      mkdirSync: vi.fn(),
      createWriteStream: vi.fn(() => ({
        write: vi.fn(),
        end: vi.fn(),
      })),
      readFileSync: vi.fn(),
    },
    mkdirSync: vi.fn(),
    createWriteStream: vi.fn(() => ({
      write: vi.fn(),
      end: vi.fn(),
    })),
    readFileSync: vi.fn(),
  };
});

vi.mock('child_process', () => {
  const spawn = vi.fn();
  return {
    spawn,
    default: {
      spawn,
    },
  };
});

describe('SafeCommandRunner Regression', () => {
  let runner: SafeCommandRunner;
  let basePolicy: ToolPolicy;
  let mockUi: UserInterface;
  let mockCtx: RunnerContext;

  beforeEach(() => {
    runner = new SafeCommandRunner();
    basePolicy = {
      enabled: true,
      requireConfirmation: false,
      autoApprove: true,
      allowlistPrefixes: [],
      denylistPatterns: [],
      networkPolicy: 'deny',
      interactive: false,
      allowShell: true,
      timeoutMs: 1000,
      maxOutputBytes: 4096,
      envAllowlist: [],
    };
    mockUi = {
      confirm: vi.fn().mockResolvedValue(true),
    };
    mockCtx = {
      runId: 'test-run-id',
      cwd: '/tmp',
    };
    vi.clearAllMocks();
  });

  describe('Network Policy', () => {
    it('should block network-related commands when networkPolicy is "deny"', () => {
      const policy = { ...basePolicy, networkPolicy: 'deny' as const };
      const networkCommands = [
        'curl http://example.com',
        'wget https://example.com',
        'git clone https://github.com/some/repo.git',
        'npm install some-package',
        'yarn add some-package',
        'pnpm add some-package',
        'fetch http://api.com/data',
      ];

      for (const command of networkCommands) {
        const result = runner.checkPolicy({ command, classification: 'unknown' }, policy);
        expect(result.isAllowed).toBe(false);
        expect(result.reason).toContain('network access');
      }
    });

    it('should allow network-related commands when networkPolicy is "allow"', () => {
      const policy = { ...basePolicy, networkPolicy: 'allow' as const };
      const networkCommands = ['curl http://example.com', 'npm install some-package'];

      for (const command of networkCommands) {
        const result = runner.checkPolicy({ command, classification: 'unknown' }, policy);
        expect(result.isAllowed).toBe(true);
      }
    });

    it('should allow allowlisted commands even if networkPolicy is "deny"', () => {
      const policy = {
        ...basePolicy,
        networkPolicy: 'deny' as const,
        allowlistPrefixes: ['curl'],
      };
      const result = runner.checkPolicy(
        { command: 'curl http://is-this-allowed.com', classification: 'network' },
        policy,
      );
      expect(result.isAllowed).toBe(true);
    });
  });

  describe('Denylist Policy', () => {
    it('should block commands matching the denylist, overriding other settings', () => {
      const policy = {
        ...basePolicy,
        // Even with auto-approve and an allowlist prefix, denylist should win.
        autoApprove: true,
        allowlistPrefixes: ['sudo'],
        denylistPatterns: ['rm -rf /', 'sudo rm'],
      };

      const deniedCommands = ['rm -rf /', 'sudo rm -rf /some/dir', 'sudo rm -fimportant.file'];

      for (const command of deniedCommands) {
        const result = runner.checkPolicy({ command, classification: 'destructive' }, policy);
        expect(result.isAllowed).toBe(false);
        expect(result.reason).toContain('denylist pattern');
      }
    });

    it('should not block commands that do not match the denylist', () => {
      const policy = {
        ...basePolicy,
        denylistPatterns: ['rm -rf /'],
      };
      const allowedCommand = 'rm -rf /tmp/safe-dir'; // Does not match `rm -rf /` exactly
      const result = runner.checkPolicy(
        { command: allowedCommand, classification: 'destructive' },
        policy,
      );
      // It might still need confirmation, but it is not disallowed by denylist
      expect(result.isAllowed).toBe(true);
    });
  });

  describe('Subprocess Environment', () => {
    beforeEach(() => {
      const mockChild = new EventEmitter() as any;
      mockChild.stdout = new EventEmitter();
      mockChild.stderr = new EventEmitter();
      mockChild.pid = 123;
      vi.mocked(spawn).mockReturnValue(mockChild);
      setTimeout(() => mockChild.emit('close', 0), 10);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should strip sensitive environment variables by default', async () => {
      const policy = { ...basePolicy, allowShell: false };
      const req: ToolRunRequest = {
        command: 'printenv',
        reason: 'test',
        env: {
          MY_APP_SECRET: 'supersecret',
          NODE_ENV: 'development',
          SOME_TOKEN: 'secret-token',
        },
      };

      // Mock process.env
      const originalEnv = process.env;
      process.env = {
        ...originalEnv,
        PROCESS_API_KEY: 'another-secret',
        LANG: 'en_US.UTF-8',
      };

      await runner.run(req, policy, mockUi, mockCtx);

      expect(spawn).toHaveBeenCalled();
      const spawnOptions = vi.mocked(spawn).mock.calls[0][2];
      const safeEnv = spawnOptions?.env;

      expect(safeEnv).toBeDefined();
      expect(safeEnv).not.toHaveProperty('MY_APP_SECRET');
      expect(safeEnv).not.toHaveProperty('SOME_TOKEN');
      expect(safeEnv).not.toHaveProperty('PROCESS_API_KEY');
      expect(safeEnv).toHaveProperty('NODE_ENV', 'development');
      expect(safeEnv).toHaveProperty('LANG', 'en_US.UTF-8');

      // Restore process.env
      process.env = originalEnv;
    });

    it('should allow environment variables specified in the envAllowlist', async () => {
      const policy = {
        ...basePolicy,
        allowShell: false,
        envAllowlist: ['MY_APP_SECRET', 'NODE_ENV'],
      };
      const req: ToolRunRequest = {
        command: 'printenv',
        reason: 'test',
        env: {
          MY_APP_SECRET: 'supersecret',
          NODE_ENV: 'development',
          SOME_TOKEN: 'secret-token',
        },
      };

      await runner.run(req, policy, mockUi, mockCtx);

      expect(spawn).toHaveBeenCalled();
      const spawnOptions = vi.mocked(spawn).mock.calls[0][2];
      const safeEnv = spawnOptions?.env;

      expect(safeEnv).toBeDefined();
      expect(safeEnv).toHaveProperty('MY_APP_SECRET', 'supersecret');
      expect(safeEnv).toHaveProperty('NODE_ENV', 'development');
      expect(safeEnv).not.toHaveProperty('SOME_TOKEN');
    });

    it('should always include PATH', async () => {
      const policy = { ...basePolicy, allowShell: false, envAllowlist: [] };
      const req: ToolRunRequest = { command: 'ls', reason: 'test' };

      const originalEnv = process.env;
      process.env = { ...originalEnv, PATH: '/bin:/usr/bin' };

      await runner.run(req, policy, mockUi, mockCtx);

      expect(spawn).toHaveBeenCalled();
      const spawnOptions = vi.mocked(spawn).mock.calls[0][2];
      const safeEnv = spawnOptions?.env;

      expect(safeEnv).toHaveProperty('PATH', '/bin:/usr/bin');

      process.env = originalEnv;
    });
  });
});
