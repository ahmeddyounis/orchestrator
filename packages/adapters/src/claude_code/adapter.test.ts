import { ClaudeCodeAdapter } from './adapter';
import { ProcessManager } from '../subprocess/process-manager';
import { ModelRequest } from '@orchestrator/shared';
import { mock } from 'vitest-mock-extended';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the ProcessManager
vi.mock('../subprocess/process-manager', () => {
  const ProcessManager = vi.fn();
  ProcessManager.prototype.spawn = vi.fn();
  ProcessManager.prototype.write = vi.fn();
  ProcessManager.prototype.kill = vi.fn();
  ProcessManager.prototype.on = vi.fn();
  ProcessManager.prototype.readUntilHeuristic = vi.fn();
  ProcessManager.prototype.isRunning = true;
  return { ProcessManager };
});

describe('ClaudeCodeAdapter', () => {
  let adapter: ClaudeCodeAdapter;
  let pm: ReturnType<typeof mock<ProcessManager>>; 

  beforeEach(() => {
    adapter = new ClaudeCodeAdapter({
      type: 'claude_code',
      model: 'claude-v1',
      command: 'claude',
      args: ['--version', '1.0'],
    });
    pm = new (ProcessManager as any)();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should send a wrapped prompt to the subprocess', async () => {
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
      // The second time this is called is after the prompt is sent
      if (pm.readUntilHeuristic.mock.calls.length === 2) {
        outputCallback(expectedDiff);
      }
      return '';
    });

    const response = await adapter.generate(req, ctx);

    // Check that the prompt was wrapped
    const sentInput = (pm.write as any).mock.calls[0][0];
    expect(sentInput).toContain('IMPORTANT: When providing code changes');
    expect(sentInput).toContain('hello');

    // Check that the diff was parsed correctly
    expect(response.text).toContain('diff --git a/file.ts b/file.ts');
    expect(response.text).not.toContain('<BEGIN_DIFF>');
  });
});

