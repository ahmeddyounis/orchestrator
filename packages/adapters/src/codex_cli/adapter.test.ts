import { CodexCliAdapter } from './adapter';
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

describe('CodexCliAdapter', () => {
  let adapter: CodexCliAdapter;
  let pm: any;

  beforeEach(() => {
    adapter = new CodexCliAdapter({
      type: 'codex_cli',
      model: 'o3-mini',
      command: 'codex',
      args: [],
    });
    pm = new (ProcessManager as any)();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should send a wrapped prompt to the subprocess and extract diffs', async () => {
    const req: ModelRequest = {
      messages: [{ role: 'user', content: 'hello' }],
    };
    const ctx = {
      logger: { log: vi.fn() } as any,
      runId: 'test-run',
      timeoutMs: 5000,
    };

    const expectedDiff = `
<BEGIN_DIFF>
diff --git a/file.ts b/file.ts
index 1234567..89abcdef 100644
--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,3 @@
-const x = 1;
+const x = 2;
<END_DIFF>
`;

    let outputCallback: (chunk: string) => void = () => {};
    pm.on.mockImplementation((event: any, callback: any) => {
      if (event === 'output') {
        outputCallback = callback;
      }
      return pm;
    });

    pm.readUntilHeuristic.mockImplementation(async () => {
      outputCallback(expectedDiff);
      return '';
    });

    const response = await adapter.generate(req, ctx);

    const spawnCommand = (pm.spawn as any).mock.calls[0][0] as string[];
    expect(spawnCommand).toContain('codex');
    expect(spawnCommand).toContain('exec');
    expect(spawnCommand).toContain('--model');
    expect(spawnCommand).toContain('o3-mini');
    expect(spawnCommand).toContain('-');

    const sentInput = (pm.write as any).mock.calls[0][0];
    expect(sentInput).toContain('IMPORTANT: When providing code changes');
    expect(sentInput).toContain('hello');

    expect(response.text).toContain('diff --git a/file.ts b/file.ts');
    expect(response.text).not.toContain('<BEGIN_DIFF>');
  });

  it('rejects config.args that include managed flags', () => {
    expect(
      () =>
        new CodexCliAdapter({
          type: 'codex_cli',
          model: 'o3-mini',
          command: 'codex',
          args: ['--json'],
        }),
    ).toThrow(/manages/i);
  });
});

