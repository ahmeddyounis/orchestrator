import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProcessManager } from '../subprocess/process-manager';
import { ModelRequest } from '@orchestrator/shared';
import {
  CodexCliAdapter,
  extractUsageFromCodexStats,
  parseCodexCliJson,
  parseTextBasedTokenUsage,
} from './adapter';
import { ConfigError } from '../errors';

vi.mock('../subprocess/process-manager', () => {
  const ProcessManager = vi.fn();
  ProcessManager.prototype.spawn = vi.fn();
  ProcessManager.prototype.write = vi.fn();
  ProcessManager.prototype.clearBuffer = vi.fn();
  ProcessManager.prototype.endInput = vi.fn();
  ProcessManager.prototype.kill = vi.fn();
  ProcessManager.prototype.on = vi.fn();
  ProcessManager.prototype.readUntil = vi.fn();
  ProcessManager.prototype.readUntilHeuristic = vi.fn();
  ProcessManager.prototype.isRunning = true;
  return { ProcessManager };
});

describe('CodexCliAdapter', () => {
  let pm: any;

  beforeEach(() => {
    pm = new (ProcessManager as any)();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('spawns `codex exec` with managed flags', async () => {
    const adapter = new CodexCliAdapter({
      type: 'codex_cli',
      model: 'o3-mini',
      command: 'codex',
      args: [],
    });

    const req: ModelRequest = { messages: [{ role: 'user', content: 'hello' }] };
    const ctx = { logger: { log: vi.fn() } as any, runId: 'test-run', timeoutMs: 5000 };

    let outputCallback: (chunk: string) => void = () => {};
    pm.on.mockImplementation((event: any, callback: any) => {
      if (event === 'output') outputCallback = callback;
      return pm;
    });
    pm.readUntil.mockResolvedValue('codex>');
    pm.readUntilHeuristic.mockImplementation(async () => {
      outputCallback('OK');
      return '';
    });

    await adapter.generate(req, ctx);

    const spawnCommand = (pm.spawn as any).mock.calls[0][0] as string[];
    expect(spawnCommand).toEqual(
      expect.arrayContaining([
        'codex',
        'exec',
        '--color',
        'never',
        '--sandbox',
        'read-only',
        '--model',
        'o3-mini',
        '-',
      ]),
    );

    const sentInput = (pm.write as any).mock.calls[0][0] as string;
    expect(sentInput).toContain('IMPORTANT: When providing code changes');
    expect(sentInput).toContain('hello');
  });

  it('injects `--oss --local-provider` when `ossMode` is enabled', async () => {
    const adapter = new CodexCliAdapter({
      type: 'codex_cli',
      model: 'o3-mini',
      command: 'codex',
      args: [],
      ossMode: true,
    } as any);

    const req: ModelRequest = { messages: [{ role: 'user', content: 'hello' }] };
    const ctx = { logger: { log: vi.fn() } as any, runId: 'test-run', timeoutMs: 5000 };

    pm.on.mockImplementation((event: any, callback: any) => {
      if (event === 'output') callback('OK');
      return pm;
    });
    pm.readUntil.mockResolvedValue('codex>');
    pm.readUntilHeuristic.mockResolvedValue('');

    await adapter.generate(req, ctx);

    const spawnCommand = (pm.spawn as any).mock.calls[0][0] as string[];
    expect(spawnCommand).toEqual(expect.arrayContaining(['--oss', '--local-provider', 'o3-mini']));
  });

  it('extracts diffs from JSON response payload', async () => {
    const adapter = new CodexCliAdapter({
      type: 'codex_cli',
      model: 'o3-mini',
      command: 'codex',
      args: [],
    });

    const req: ModelRequest = { messages: [{ role: 'user', content: 'hello' }] };
    const ctx = { logger: { log: vi.fn() } as any, runId: 'test-run', timeoutMs: 5000 };

    const expectedDiff = `<BEGIN_DIFF>
diff --git a/file.ts b/file.ts
index 1234567..89abcdef 100644
--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,3 @@
-const x = 1;
+const x = 2;
<END_DIFF>`;

    const payload = JSON.stringify({
      response: expectedDiff,
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    });

    let outputCallback: (chunk: string) => void = () => {};
    pm.on.mockImplementation((event: any, callback: any) => {
      if (event === 'output') outputCallback = callback;
      return pm;
    });
    pm.readUntil.mockResolvedValue('codex>');
    pm.readUntilHeuristic.mockImplementation(async () => {
      outputCallback(payload);
      return '';
    });

    const response = await adapter.generate(req, ctx);

    expect(response.text).toContain('diff --git a/file.ts b/file.ts');
    expect(response.text).not.toContain('<BEGIN_DIFF>');
    expect(response.usage?.inputTokens).toBe(10);
    expect(response.usage?.outputTokens).toBe(5);
    expect(response.usage?.totalTokens).toBe(15);
  });

  it('rejects managed flags in config.args', () => {
    expect(
      () =>
        new CodexCliAdapter({
          type: 'codex_cli',
          model: 'o3-mini',
          command: 'codex',
          args: ['--model', 'o3-mini'],
        }),
    ).toThrow(ConfigError);
  });
});

describe('codex_cli parsers', () => {
  it('parseCodexCliJson extracts JSON object from surrounding text', () => {
    const parsed = parseCodexCliJson('prefix {"response":"hi"} suffix');
    expect(parsed).toEqual({ response: 'hi' });
  });

  it('extractUsageFromCodexStats reads usage fields', () => {
    const usage = extractUsageFromCodexStats({
      usage: { input_tokens: 3, output_tokens: 4, total_tokens: 7 },
    });
    expect(usage).toEqual({ inputTokens: 3, outputTokens: 4, totalTokens: 7 });
  });

  it('parseTextBasedTokenUsage parses "X in / Y out" pattern', () => {
    const usage = parseTextBasedTokenUsage('Tokens used: 12 in / 34 out');
    expect(usage).toEqual({ inputTokens: 12, outputTokens: 34, totalTokens: 46 });
  });
});

