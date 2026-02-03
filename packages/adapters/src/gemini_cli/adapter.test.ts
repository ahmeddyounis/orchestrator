import { GeminiCliAdapter } from './adapter';
import { ProcessManager } from '../subprocess/process-manager';
import { ModelRequest } from '@orchestrator/shared';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../subprocess/process-manager', () => {
  const ProcessManager = vi.fn();
  ProcessManager.prototype.spawn = vi.fn();
  ProcessManager.prototype.write = vi.fn();
  ProcessManager.prototype.clearBuffer = vi.fn();
  ProcessManager.prototype.endInput = vi.fn();
  ProcessManager.prototype.kill = vi.fn();
  ProcessManager.prototype.on = vi.fn();
  ProcessManager.prototype.readUntilHeuristic = vi.fn();
  ProcessManager.prototype.isRunning = true;
  return { ProcessManager };
});

describe('GeminiCliAdapter', () => {
  let adapter: GeminiCliAdapter;
  let pm: any;

  beforeEach(() => {
    adapter = new GeminiCliAdapter({
      type: 'gemini_cli',
      model: 'gemini-2.5-flash',
      command: 'gemini',
      args: [],
    });
    pm = new (ProcessManager as any)();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('parses JSON output and extracts diffs', async () => {
    const req: ModelRequest = { messages: [{ role: 'user', content: 'hello' }] };
    const ctx = {
      logger: { log: vi.fn() } as any,
      runId: 'test-run',
      timeoutMs: 5000,
    };

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
      stats: {
        models: {
          'gemini-2.5-flash': { tokens: { prompt: 10, candidates: 5, total: 15 } },
        },
      },
    });

    let outputCallback: (chunk: string) => void = () => {};
    pm.on.mockImplementation((event: any, callback: any) => {
      if (event === 'output') outputCallback = callback;
      return pm;
    });

    pm.readUntilHeuristic.mockImplementation(async () => {
      outputCallback(payload);
      return '';
    });

    const response = await adapter.generate(req, ctx);

    const sentInput = (pm.write as any).mock.calls[0][0];
    expect(sentInput).toContain('IMPORTANT: When providing code changes');
    expect(sentInput).toContain('hello');

    expect(response.text).toContain('diff --git a/file.ts b/file.ts');
    expect(response.text).not.toContain('<BEGIN_DIFF>');

    expect(response.usage?.inputTokens).toBe(10);
    expect(response.usage?.outputTokens).toBe(5);
    expect(response.usage?.totalTokens).toBe(15);
  });

  it('rejects config.args that include managed flags', () => {
    expect(
      () =>
        new GeminiCliAdapter({
          type: 'gemini_cli',
          model: 'gemini-2.5-flash',
          command: 'gemini',
          args: ['--output-format', 'text'],
        }),
    ).toThrow(/manages/i);
  });
});
