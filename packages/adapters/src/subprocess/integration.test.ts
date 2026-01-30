import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs/promises';
import { SubprocessProviderAdapter } from './adapter';
import { ProcessManager } from './process-manager';
import { AdapterContext } from '../types';
import { ModelRequest, Logger } from '@orchestrator/shared';

const FAKE_CLI_PATH = path.resolve(__dirname, 'fixtures/fake-agent-cli.js');

describe('Subprocess Integration', () => {
  const mockLogger = {
    log: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  const ctx: AdapterContext = {
    runId: 'test-run-id-integration',
    logger: mockLogger as unknown as Logger,
    timeoutMs: 5000,
  };

  const runDir = path.join(
    process.cwd(),
    '.orchestrator',
    'runs',
    'test-run-id-integration',
    'tool_logs',
  );

  beforeEach(async () => {
    await fs.mkdir(runDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(runDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('should handle basic interaction via Adapter', async () => {
    const adapter = new SubprocessProviderAdapter({
      command: ['node', FAKE_CLI_PATH],
    });

    const req: ModelRequest = {
      messages: [{ role: 'user', content: 'hello world' }],
    };

    const response = await adapter.generate(req, ctx);

    expect(response.text).toContain('You said: hello world');
  });

  it('should timeout when CLI is too slow', async () => {
    const adapter = new SubprocessProviderAdapter({
      command: ['node', FAKE_CLI_PATH, '--slow'],
    });

    const shortCtx = { ...ctx, timeoutMs: 1000 };

    await expect(
      adapter.generate({ messages: [{ role: 'user', content: 'foo' }] }, shortCtx),
    ).rejects.toThrow('Process timed out');
  });

  it('should timeout if end marker is missing', async () => {
    const adapter = new SubprocessProviderAdapter({
      command: ['node', FAKE_CLI_PATH, '--no-end-marker'],
    });

    const shortCtx = { ...ctx, timeoutMs: 1500 };

    await expect(
      adapter.generate({ messages: [{ role: 'user', content: 'foo' }] }, shortCtx),
    ).rejects.toThrow('Process timed out');
  });

  it('should enforce maxOutputSize via ProcessManager', async () => {
    const pm = new ProcessManager({
      maxOutputSize: 50 * 1024,
      logger: mockLogger as unknown as Logger,
    });

    const resultPromise = new Promise<void>((resolve, reject) => {
      pm.on('exit', () => resolve());
      pm.on('error', (err) => reject(err));
    });

    await pm.spawn(['node', FAKE_CLI_PATH, '--large'], process.cwd(), {}, false);
    pm.write('trigger\n');

    await expect(resultPromise).rejects.toThrow('Max output size 51200 exceeded');
    pm.kill();
  });
});
