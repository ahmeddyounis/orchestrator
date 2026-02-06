import { GeminiCliAdapter, parseGeminiCliJson, extractUsageFromStats } from './adapter';
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

  it('throws ConfigError when model is undefined', () => {
    expect(
      () =>
        new GeminiCliAdapter({
          type: 'gemini_cli',
          command: 'gemini',
          args: [],
        } as any),
    ).toThrow(/requires a model/i);
  });

  it('throws ConfigError when model is empty string', () => {
    expect(
      () =>
        new GeminiCliAdapter({
          type: 'gemini_cli',
          model: '',
          command: 'gemini',
          args: [],
        }),
    ).toThrow(/requires a model/i);
  });

  it('falls back to raw text when output is not valid JSON', async () => {
    const req: ModelRequest = { messages: [{ role: 'user', content: 'hello' }] };
    const ctx = {
      logger: { log: vi.fn() } as any,
      runId: 'test-run',
      timeoutMs: 5000,
    };

    const plainText = 'This is a plain text response with no JSON structure.';

    let outputCallback: (chunk: string) => void = () => {};
    pm.on.mockImplementation((event: any, callback: any) => {
      if (event === 'output') outputCallback = callback;
      return pm;
    });

    pm.readUntilHeuristic.mockImplementation(async () => {
      outputCallback(plainText);
      return '';
    });

    const response = await adapter.generate(req, ctx);

    expect(response.text).toBe(plainText);
  });

  it('returns plan-parsed response for plan markers without diff markers', async () => {
    const req: ModelRequest = { messages: [{ role: 'user', content: 'hello' }] };
    const ctx = {
      logger: { log: vi.fn() } as any,
      runId: 'test-run',
      timeoutMs: 5000,
    };

    const planText = `1. Add a new file called utils.ts
2. Update the imports in index.ts
3. Fix the broken test in adapter.test.ts`;

    const payload = JSON.stringify({
      response: planText,
      stats: {
        models: {
          'gemini-2.5-flash': { tokens: { prompt: 20, candidates: 10, total: 30 } },
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

    // Should return the plan text as-is (not extracted as a diff)
    expect(response.text).toBe(planText);
    expect(response.usage?.inputTokens).toBe(20);
    expect(response.usage?.outputTokens).toBe(10);

    // Should have logged a plan-kind event
    const logCalls = ctx.logger.log.mock.calls;
    const planLog = logCalls.find(
      (call: any) => call[0]?.type === 'SubprocessParsed' && call[0]?.payload?.kind === 'plan',
    );
    expect(planLog).toBeDefined();
  });
});

describe('parseGeminiCliJson', () => {
  it('returns null for text with no braces', () => {
    expect(parseGeminiCliJson('no json here')).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(parseGeminiCliJson('{ broken json }')).toBeNull();
  });

  it('extracts JSON from surrounding text', () => {
    const result = parseGeminiCliJson('some prefix {"response":"hello"} some suffix');
    expect(result).toEqual({ response: 'hello' });
  });

  it('returns parsed object for valid JSON', () => {
    const input = JSON.stringify({ response: 'test', stats: { models: {} } });
    const result = parseGeminiCliJson(input);
    expect(result).toEqual({ response: 'test', stats: { models: {} } });
  });
});

describe('extractUsageFromStats', () => {
  it('returns undefined for null stats', () => {
    expect(extractUsageFromStats(null)).toBeUndefined();
  });

  it('returns undefined for non-object stats', () => {
    expect(extractUsageFromStats('not an object')).toBeUndefined();
  });

  it('returns undefined when models is missing', () => {
    expect(extractUsageFromStats({})).toBeUndefined();
  });

  it('returns undefined when models is not an object', () => {
    expect(extractUsageFromStats({ models: 'string' })).toBeUndefined();
  });

  it('returns undefined when all token fields are zero', () => {
    const stats = {
      models: {
        'model-a': { tokens: { prompt: 0, candidates: 0, total: 0 } },
      },
    };
    expect(extractUsageFromStats(stats)).toBeUndefined();
  });

  it('returns undefined when tokens object is missing', () => {
    const stats = {
      models: {
        'model-a': {},
      },
    };
    expect(extractUsageFromStats(stats)).toBeUndefined();
  });

  it('uses input field when prompt field is absent', () => {
    const stats = {
      models: {
        'model-a': { tokens: { input: 7, candidates: 3, total: 10 } },
      },
    };
    const result = extractUsageFromStats(stats);
    expect(result).toEqual({ inputTokens: 7, outputTokens: 3, totalTokens: 10 });
  });

  it('sums tokens across multiple models', () => {
    const stats = {
      models: {
        'model-a': { tokens: { prompt: 10, candidates: 5, total: 15 } },
        'model-b': { tokens: { prompt: 20, candidates: 10, total: 30 } },
      },
    };
    const result = extractUsageFromStats(stats);
    expect(result).toEqual({ inputTokens: 30, outputTokens: 15, totalTokens: 45 });
  });

  it('handles non-numeric token values gracefully', () => {
    const stats = {
      models: {
        'model-a': { tokens: { prompt: 'bad', candidates: null, total: undefined } },
        'model-b': { tokens: { prompt: 5, candidates: 3, total: 8 } },
      },
    };
    const result = extractUsageFromStats(stats);
    expect(result).toEqual({ inputTokens: 5, outputTokens: 3, totalTokens: 8 });
  });
});
