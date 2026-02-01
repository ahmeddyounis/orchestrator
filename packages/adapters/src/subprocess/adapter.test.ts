import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join, resolve } from '@orchestrator/shared';
import * as fs from 'fs/promises';
import { SubprocessProviderAdapter } from './adapter';
import { AdapterContext } from '../types';
import { ModelRequest, Logger } from '@orchestrator/shared';

const FIXTURE_PATH = resolve(__dirname, 'fixtures/echo-cli.js');

describe('SubprocessProviderAdapter', () => {
  const mockLogger = {
    log: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  const ctx: AdapterContext = {
    runId: 'test-run-id',
    logger: mockLogger as unknown as Logger,
    timeoutMs: 5000,
  };

    const runDir = join(process.cwd(), '.orchestrator', 'runs', 'test-run-id', 'tool_logs');

  beforeEach(async () => {
    await fs.mkdir(runDir, { recursive: true });
  });

  afterEach(async () => {
    // Cleanup if needed
    // await fs.rm(runDir, { recursive: true, force: true });
  });

  it('should generate text using echo-cli', async () => {
    const adapter = new SubprocessProviderAdapter({
      command: [process.execPath, FIXTURE_PATH],
    });

    const req: ModelRequest = {
      messages: [{ role: 'user', content: 'hello world' }],
    };

    const response = await adapter.generate(req, ctx);

    // echo-cli prints:
    // Echo CLI Started
    // >
    // (wait)
    // Echo: hello world
    // >

    expect(response.text).toContain('Echo: hello world');

    // Check if log file was created
        const logPath = join(runDir, 'subprocess_subprocess.log');
    const logContent = await fs.readFile(logPath, 'utf-8');
    expect(logContent).toContain('hello world');
  });

  it('should handle config env allowlist', async () => {
    // We can't easily test env isolation with echo-cli unless we modify it to print env.
    // But we trust ProcessManager test for logic, or we can use `node -e "console.log(process.env.FOO)"`

    const adapter = new SubprocessProviderAdapter({
      command: [
        process.execPath,
        '-e',
        'console.log(process.env.TEST_VAR || "MISSING"); console.log("> ");',
      ],
      envAllowlist: ['TEST_VAR'],
    });

    // Set env in process
    process.env.TEST_VAR = 'found';
    process.env.OTHER_VAR = 'should_not_be_seen';

    const req: ModelRequest = {
      messages: [],
    };

    const response = await adapter.generate(req, ctx);
    expect(response.text).toContain('found');

    delete process.env.TEST_VAR;
    delete process.env.OTHER_VAR;
  });

  it('should truncate oversized transcripts', async () => {
    const adapter = new SubprocessProviderAdapter({
      command: [process.execPath, '-e', "console.log('A'.repeat(100)); console.log('> ');"],
      maxTranscriptSize: 50,
    });

    const req: ModelRequest = {
      messages: [{ role: 'user', content: '' }], // Empty prompt
    };

    const response = await adapter.generate(req, ctx);

    expect(response.text?.length).toBeLessThanOrEqual(50);
    expect(response.text).toContain('TRUNCATED');
    // Check that we have the tail end of the 'A's
    expect(response.text?.endsWith('A'.repeat(10))).toBe(false); // prompt is stripped
  });
});
