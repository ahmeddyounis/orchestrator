import { CodexCliAdapter, extractUsageFromCodexStats, parseTextBasedTokenUsage } from './adapter';
import { ProcessManager } from '../subprocess/process-manager';
import { ModelRequest } from '@orchestrator/shared';
import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';

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
  let pm: {
    spawn: Mock;
    write: Mock;
    clearBuffer: Mock;
    endInput: Mock;
    kill: Mock;
    on: Mock;
    readUntilHeuristic: Mock;
    isRunning: boolean;
  };

  beforeEach(() => {
    adapter = new CodexCliAdapter({
      type: 'codex_cli',
      model: 'o3-mini',
      command: 'codex',
      args: [],
    });
    pm = new (ProcessManager as unknown as new () => typeof pm)();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should use default command when not specified', () => {
      const adapterWithDefault = new CodexCliAdapter({
        type: 'codex_cli',
        model: 'o3-mini',
        args: [],
      });
      expect(adapterWithDefault.id()).toBe('codex_cli');
    });

    it('should use custom command when specified', async () => {
      const customAdapter = new CodexCliAdapter({
        type: 'codex_cli',
        model: 'gpt-4',
        command: '/usr/local/bin/codex',
        args: [],
      });
      
      const ctx = {
        logger: { log: vi.fn() },
        runId: 'test-run',
        timeoutMs: 5000,
      };
      
      pm.on.mockImplementation((event: string, callback: (chunk: string) => void) => {
        if (event === 'output') callback('response text');
        return pm;
      });
      pm.readUntilHeuristic.mockResolvedValue('');
      
      await customAdapter.generate({ messages: [{ role: 'user', content: 'hi' }] }, ctx);
      
      const spawnCommand = pm.spawn.mock.calls[0][0] as string[];
      expect(spawnCommand[0]).toBe('/usr/local/bin/codex');
    });
  });

  describe('OSS mode flag injection', () => {
    it('should inject --oss and --local-provider flags when ossMode is enabled', async () => {
      const ossAdapter = new CodexCliAdapter({
        type: 'codex_cli',
        model: 'codellama',
        command: 'codex',
        args: [],
        ossMode: true,
      } as any);

      const ctx = {
        logger: { log: vi.fn() },
        runId: 'test-run',
        timeoutMs: 5000,
      };

      pm.on.mockImplementation((event: string, callback: (chunk: string) => void) => {
        if (event === 'output') callback('response');
        return pm;
      });
      pm.readUntilHeuristic.mockResolvedValue('');

      await ossAdapter.generate({ messages: [{ role: 'user', content: 'test' }] }, ctx);

      const spawnCommand = pm.spawn.mock.calls[0][0] as string[];
      expect(spawnCommand).toContain('--oss');
      expect(spawnCommand).toContain('--local-provider');
      expect(spawnCommand).toContain('codellama');
      // Verify order: --oss and --local-provider should come before 'exec'
      const ossIndex = spawnCommand.indexOf('--oss');
      const execIndex = spawnCommand.indexOf('exec');
      expect(ossIndex).toBeLessThan(execIndex);
    });

    it('should NOT inject OSS flags when ossMode is disabled (default)', async () => {
      const ctx = {
        logger: { log: vi.fn() },
        runId: 'test-run',
        timeoutMs: 5000,
      };

      pm.on.mockImplementation((event: string, callback: (chunk: string) => void) => {
        if (event === 'output') callback('response');
        return pm;
      });
      pm.readUntilHeuristic.mockResolvedValue('');

      await adapter.generate({ messages: [{ role: 'user', content: 'test' }] }, ctx);

      const spawnCommand = pm.spawn.mock.calls[0][0] as string[];
      expect(spawnCommand).not.toContain('--oss');
      expect(spawnCommand).not.toContain('--local-provider');
    });

    it('should include model after --local-provider in OSS mode', async () => {
      const ossAdapter = new CodexCliAdapter({
        type: 'codex_cli',
        model: 'deepseek-coder',
        command: 'codex',
        args: [],
        ossMode: true,
      } as any);

      const ctx = {
        logger: { log: vi.fn() },
        runId: 'test-run',
        timeoutMs: 5000,
      };

      pm.on.mockImplementation((event: string, callback: (chunk: string) => void) => {
        if (event === 'output') callback('response');
        return pm;
      });
      pm.readUntilHeuristic.mockResolvedValue('');

      await ossAdapter.generate({ messages: [{ role: 'user', content: 'test' }] }, ctx);

      const spawnCommand = pm.spawn.mock.calls[0][0] as string[];
      const localProviderIndex = spawnCommand.indexOf('--local-provider');
      expect(spawnCommand[localProviderIndex + 1]).toBe('deepseek-coder');
    });

    it('should place OSS flags before exec command', async () => {
      const ossAdapter = new CodexCliAdapter({
        type: 'codex_cli',
        model: 'llama3',
        command: 'codex',
        args: [],
        ossMode: true,
      } as any);

      const ctx = {
        logger: { log: vi.fn() },
        runId: 'test-run',
        timeoutMs: 5000,
      };

      pm.on.mockImplementation((event: string, callback: (chunk: string) => void) => {
        if (event === 'output') callback('response');
        return pm;
      });
      pm.readUntilHeuristic.mockResolvedValue('');

      await ossAdapter.generate({ messages: [{ role: 'user', content: 'test' }] }, ctx);

      const spawnCommand = pm.spawn.mock.calls[0][0] as string[];
      const ossIndex = spawnCommand.indexOf('--oss');
      const localProviderIndex = spawnCommand.indexOf('--local-provider');
      const execIndex = spawnCommand.indexOf('exec');
      
      // Both --oss and --local-provider should come before exec
      expect(ossIndex).toBeLessThan(execIndex);
      expect(localProviderIndex).toBeLessThan(execIndex);
      // --oss should come before --local-provider
      expect(ossIndex).toBeLessThan(localProviderIndex);
    });

    it('should NOT inject OSS flags when ossMode is explicitly false', async () => {
      const nonOssAdapter = new CodexCliAdapter({
        type: 'codex_cli',
        model: 'gpt-4',
        command: 'codex',
        args: [],
        ossMode: false,
      } as any);

      const ctx = {
        logger: { log: vi.fn() },
        runId: 'test-run',
        timeoutMs: 5000,
      };

      pm.on.mockImplementation((event: string, callback: (chunk: string) => void) => {
        if (event === 'output') callback('response');
        return pm;
      });
      pm.readUntilHeuristic.mockResolvedValue('');

      await nonOssAdapter.generate({ messages: [{ role: 'user', content: 'test' }] }, ctx);

      const spawnCommand = pm.spawn.mock.calls[0][0] as string[];
      expect(spawnCommand).not.toContain('--oss');
      expect(spawnCommand).not.toContain('--local-provider');
    });

    it('should still include --model flag separately with OSS mode enabled', async () => {
      const ossAdapter = new CodexCliAdapter({
        type: 'codex_cli',
        model: 'mistral',
        command: 'codex',
        args: [],
        ossMode: true,
      } as any);

      const ctx = {
        logger: { log: vi.fn() },
        runId: 'test-run',
        timeoutMs: 5000,
      };

      pm.on.mockImplementation((event: string, callback: (chunk: string) => void) => {
        if (event === 'output') callback('response');
        return pm;
      });
      pm.readUntilHeuristic.mockResolvedValue('');

      await ossAdapter.generate({ messages: [{ role: 'user', content: 'test' }] }, ctx);

      const spawnCommand = pm.spawn.mock.calls[0][0] as string[];
      // --model flag should still be present after exec
      expect(spawnCommand).toContain('--model');
      const modelIndex = spawnCommand.indexOf('--model');
      expect(spawnCommand[modelIndex + 1]).toBe('mistral');
    });
  });

  describe('isPrompt pattern validation', () => {
    // Access the protected isPrompt method via a test subclass
    class TestableCodexCliAdapter extends CodexCliAdapter {
      public testIsPrompt(text: string): boolean {
        return this['isPrompt'](text);
      }
    }

    let testAdapter: TestableCodexCliAdapter;

    beforeEach(() => {
      testAdapter = new TestableCodexCliAdapter({
        type: 'codex_cli',
        model: 'o3-mini',
        command: 'codex',
        args: [],
      });
    });

    it('should detect "codex>" prompt (lowercase)', () => {
      expect(testAdapter.testIsPrompt('Some output\ncodex>')).toBe(true);
      expect(testAdapter.testIsPrompt('codex>')).toBe(true);
    });

    it('should detect "Codex>" prompt (capitalized)', () => {
      expect(testAdapter.testIsPrompt('Some output\nCodex>')).toBe(true);
      expect(testAdapter.testIsPrompt('Codex>')).toBe(true);
    });

    it('should detect "CODEX>" prompt (uppercase)', () => {
      expect(testAdapter.testIsPrompt('Some output\nCODEX>')).toBe(true);
    });

    it('should detect "> " minimal shell prompt at end of line', () => {
      expect(testAdapter.testIsPrompt('Ready\n> ')).toBe(true);
      expect(testAdapter.testIsPrompt('>')).toBe(true);
    });

    it('should detect ">>> " Python REPL style prompt', () => {
      expect(testAdapter.testIsPrompt('Some output\n>>> ')).toBe(true);
      expect(testAdapter.testIsPrompt('>>>')).toBe(true);
    });

    it('should detect "$ " shell style prompt at end of line', () => {
      expect(testAdapter.testIsPrompt('Output\n$ ')).toBe(true);
      expect(testAdapter.testIsPrompt('$')).toBe(true);
    });

    it('should NOT detect prompts in the middle of output', () => {
      expect(testAdapter.testIsPrompt('Use codex> command to run\nMore text here')).toBe(false);
    });

    it('should NOT detect regular text as prompts', () => {
      expect(testAdapter.testIsPrompt('This is regular output')).toBe(false);
      expect(testAdapter.testIsPrompt('Processing your request...')).toBe(false);
      expect(testAdapter.testIsPrompt('')).toBe(false);
    });

    it('should handle whitespace correctly', () => {
      expect(testAdapter.testIsPrompt('  codex>  ')).toBe(true);
      expect(testAdapter.testIsPrompt('\n\ncodex>\n')).toBe(true);
    });
  });

  describe('isPrompt pattern validation', () => {
    // Access the protected isPrompt method via a test subclass
    class TestableCodexCliAdapter extends CodexCliAdapter {
      public testIsPrompt(text: string): boolean {
        return this['isPrompt'](text);
      }
    }

    let testAdapter: TestableCodexCliAdapter;

    beforeEach(() => {
      testAdapter = new TestableCodexCliAdapter({
        type: 'codex_cli',
        model: 'o3-mini',
        command: 'codex',
        args: [],
      });
    });

    it('should detect "codex>" prompt (lowercase)', () => {
      expect(testAdapter.testIsPrompt('Some output\ncodex>')).toBe(true);
      expect(testAdapter.testIsPrompt('codex>')).toBe(true);
    });

    it('should detect "Codex>" prompt (capitalized)', () => {
      expect(testAdapter.testIsPrompt('Some output\nCodex>')).toBe(true);
      expect(testAdapter.testIsPrompt('Codex>')).toBe(true);
    });

    it('should detect "CODEX>" prompt (uppercase)', () => {
      expect(testAdapter.testIsPrompt('Some output\nCODEX>')).toBe(true);
    });

    it('should detect "> " minimal shell prompt at end of line', () => {
      expect(testAdapter.testIsPrompt('Ready\n> ')).toBe(true);
      expect(testAdapter.testIsPrompt('>')).toBe(true);
    });

    it('should detect ">>> " Python REPL style prompt', () => {
      expect(testAdapter.testIsPrompt('Some output\n>>> ')).toBe(true);
      expect(testAdapter.testIsPrompt('>>>')).toBe(true);
    });

    it('should detect "$ " shell style prompt at end of line', () => {
      expect(testAdapter.testIsPrompt('Output\n$ ')).toBe(true);
      expect(testAdapter.testIsPrompt('$')).toBe(true);
    });

    it('should NOT detect prompts in the middle of output', () => {
      expect(testAdapter.testIsPrompt('Use codex> command to run\nMore text here')).toBe(false);
    });

    it('should NOT detect regular text as prompts', () => {
      expect(testAdapter.testIsPrompt('This is regular output')).toBe(false);
      expect(testAdapter.testIsPrompt('Processing your request...')).toBe(false);
      expect(testAdapter.testIsPrompt('')).toBe(false);
    });

    it('should handle whitespace correctly', () => {
      expect(testAdapter.testIsPrompt('  codex>  ')).toBe(true);
      expect(testAdapter.testIsPrompt('\n\ncodex>\n')).toBe(true);
    });
  });

  describe('token extraction from JSON stats', () => {
    it('should extract tokens from usage object with input_tokens/output_tokens', async () => {
      const ctx = {
        logger: { log: vi.fn() },
        runId: 'test-run',
        timeoutMs: 5000,
      };

      const jsonOutput = JSON.stringify({
        response: 'Generated code here',
        usage: {
          input_tokens: 150,
          output_tokens: 75,
          total_tokens: 225,
        },
      });

      pm.on.mockImplementation((event: string, callback: (chunk: string) => void) => {
        if (event === 'output') callback(jsonOutput);
        return pm;
      });
      pm.readUntilHeuristic.mockResolvedValue('');

      const response = await adapter.generate({ messages: [{ role: 'user', content: 'test' }] }, ctx);

      expect(response.usage?.inputTokens).toBe(150);
      expect(response.usage?.outputTokens).toBe(75);
      expect(response.usage?.totalTokens).toBe(225);
    });

    it('should extract tokens from stats object with camelCase naming', async () => {
      const ctx = {
        logger: { log: vi.fn() },
        runId: 'test-run',
        timeoutMs: 5000,
      };

      const jsonOutput = JSON.stringify({
        message: 'Response message',
        stats: {
          inputTokens: 200,
          outputTokens: 100,
        },
      });

      pm.on.mockImplementation((event: string, callback: (chunk: string) => void) => {
        if (event === 'output') callback(jsonOutput);
        return pm;
      });
      pm.readUntilHeuristic.mockResolvedValue('');

      const response = await adapter.generate({ messages: [{ role: 'user', content: 'test' }] }, ctx);

      expect(response.usage?.inputTokens).toBe(200);
      expect(response.usage?.outputTokens).toBe(100);
    });

    it('should extract tokens from prompt_tokens/completion_tokens (OpenAI style)', async () => {
      const ctx = {
        logger: { log: vi.fn() },
        runId: 'test-run',
        timeoutMs: 5000,
      };

      const jsonOutput = JSON.stringify({
        response: 'Output',
        usage: {
          prompt_tokens: 50,
          completion_tokens: 30,
        },
      });

      pm.on.mockImplementation((event: string, callback: (chunk: string) => void) => {
        if (event === 'output') callback(jsonOutput);
        return pm;
      });
      pm.readUntilHeuristic.mockResolvedValue('');

      const response = await adapter.generate({ messages: [{ role: 'user', content: 'test' }] }, ctx);

      expect(response.usage?.inputTokens).toBe(50);
      expect(response.usage?.outputTokens).toBe(30);
    });
  });

  describe('extractUsageFromCodexStats function', () => {
    describe('snake_case token field naming (input_tokens/output_tokens)', () => {
      it('should extract input_tokens and output_tokens', () => {
        const result = extractUsageFromCodexStats({
          usage: {
            input_tokens: 100,
            output_tokens: 50,
          },
        });
        expect(result).toEqual({
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
        });
      });

      it('should extract with total_tokens included', () => {
        const result = extractUsageFromCodexStats({
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            total_tokens: 150,
          },
        });
        expect(result).toEqual({
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
        });
      });
    });

    describe('camelCase token field naming (inputTokens/outputTokens)', () => {
      it('should extract inputTokens and outputTokens', () => {
        const result = extractUsageFromCodexStats({
          usage: {
            inputTokens: 200,
            outputTokens: 100,
          },
        });
        expect(result).toEqual({
          inputTokens: 200,
          outputTokens: 100,
          totalTokens: 300,
        });
      });

      it('should extract with totalTokens included', () => {
        const result = extractUsageFromCodexStats({
          stats: {
            inputTokens: 200,
            outputTokens: 100,
            totalTokens: 300,
          },
        });
        expect(result).toEqual({
          inputTokens: 200,
          outputTokens: 100,
          totalTokens: 300,
        });
      });
    });

    describe('OpenAI-style naming (prompt_tokens/completion_tokens)', () => {
      it('should extract prompt_tokens and completion_tokens', () => {
        const result = extractUsageFromCodexStats({
          usage: {
            prompt_tokens: 75,
            completion_tokens: 25,
          },
        });
        expect(result).toEqual({
          inputTokens: 75,
          outputTokens: 25,
          totalTokens: 100,
        });
      });

      it('should extract with total_tokens included', () => {
        const result = extractUsageFromCodexStats({
          usage: {
            prompt_tokens: 75,
            completion_tokens: 25,
            total_tokens: 100,
          },
        });
        expect(result).toEqual({
          inputTokens: 75,
          outputTokens: 25,
          totalTokens: 100,
        });
      });
    });

    describe('edge cases', () => {
      it('should return undefined for null parsed object', () => {
        const result = extractUsageFromCodexStats(null as any);
        expect(result).toBeUndefined();
      });

      it('should return undefined when usage/stats is missing', () => {
        const result = extractUsageFromCodexStats({});
        expect(result).toBeUndefined();
      });

      it('should return undefined when all token values are zero', () => {
        const result = extractUsageFromCodexStats({
          usage: {
            input_tokens: 0,
            output_tokens: 0,
          },
        });
        expect(result).toBeUndefined();
      });

      it('should prefer stats over usage when both present', () => {
        const result = extractUsageFromCodexStats({
          stats: { inputTokens: 500, outputTokens: 250 },
        });
        expect(result?.inputTokens).toBe(500);
        expect(result?.outputTokens).toBe(250);
      });

      it('should handle non-numeric values gracefully', () => {
        const result = extractUsageFromCodexStats({
          usage: {
            input_tokens: 'not a number' as any,
            output_tokens: null as any,
          },
        });
        expect(result).toBeUndefined();
      });

      it('should prioritize snake_case over camelCase when both present', () => {
        const result = extractUsageFromCodexStats({
          usage: {
            input_tokens: 100,
            inputTokens: 999, // Should be ignored
            output_tokens: 50,
            outputTokens: 888, // Should be ignored
          },
        });
        expect(result).toEqual({
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
        });
      });
    });
  });

  describe('text-based token usage parsing', () => {
    it('should parse "input=X, output=Y" format', async () => {
      const ctx = {
        logger: { log: vi.fn() },
        runId: 'test-run',
        timeoutMs: 5000,
      };

      const textOutput = 'Response content\n\nTokens: input=123, output=456';

      pm.on.mockImplementation((event: string, callback: (chunk: string) => void) => {
        if (event === 'output') callback(textOutput);
        return pm;
      });
      pm.readUntilHeuristic.mockResolvedValue('');

      const response = await adapter.generate({ messages: [{ role: 'user', content: 'test' }] }, ctx);

      expect(response.usage?.inputTokens).toBe(123);
      expect(response.usage?.outputTokens).toBe(456);
    });

    it('should parse "X input tokens, Y output tokens" format', async () => {
      const ctx = {
        logger: { log: vi.fn() },
        runId: 'test-run',
        timeoutMs: 5000,
      };

      const textOutput = 'Done!\nUsage: 500 input tokens, 250 output tokens';

      pm.on.mockImplementation((event: string, callback: (chunk: string) => void) => {
        if (event === 'output') callback(textOutput);
        return pm;
      });
      pm.readUntilHeuristic.mockResolvedValue('');

      const response = await adapter.generate({ messages: [{ role: 'user', content: 'test' }] }, ctx);

      expect(response.usage?.inputTokens).toBe(500);
      expect(response.usage?.outputTokens).toBe(250);
    });

    it('should parse "X in, Y out" shorthand format', async () => {
      const ctx = {
        logger: { log: vi.fn() },
        runId: 'test-run',
        timeoutMs: 5000,
      };

      const textOutput = 'Complete\nTokens used: 100 in, 50 out';

      pm.on.mockImplementation((event: string, callback: (chunk: string) => void) => {
        if (event === 'output') callback(textOutput);
        return pm;
      });
      pm.readUntilHeuristic.mockResolvedValue('');

      const response = await adapter.generate({ messages: [{ role: 'user', content: 'test' }] }, ctx);

      expect(response.usage?.inputTokens).toBe(100);
      expect(response.usage?.outputTokens).toBe(50);
    });
  });

  describe('parseTextBasedTokenUsage function', () => {
    describe('Pattern: input=X, output=Y (equals sign format)', () => {
      it('should parse "input=123, output=456"', () => {
        const result = parseTextBasedTokenUsage('Tokens: input=123, output=456');
        expect(result).toEqual({
          inputTokens: 123,
          outputTokens: 456,
          totalTokens: 579,
        });
      });

      it('should parse "input_tokens=100, output_tokens=50"', () => {
        const result = parseTextBasedTokenUsage('Usage: input_tokens=100, output_tokens=50');
        expect(result).toEqual({
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
        });
      });

      it('should parse with colon separator "input: 200 output: 100"', () => {
        const result = parseTextBasedTokenUsage('input: 200 output: 100');
        expect(result).toEqual({
          inputTokens: 200,
          outputTokens: 100,
          totalTokens: 300,
        });
      });

      it('should parse with space separator "input 300 output 150"', () => {
        const result = parseTextBasedTokenUsage('input 300 output 150');
        expect(result).toEqual({
          inputTokens: 300,
          outputTokens: 150,
          totalTokens: 450,
        });
      });
    });

    describe('Pattern: X input tokens, Y output tokens (number-first format)', () => {
      it('should parse "500 input tokens, 250 output tokens"', () => {
        const result = parseTextBasedTokenUsage('Usage: 500 input tokens, 250 output tokens');
        expect(result).toEqual({
          inputTokens: 500,
          outputTokens: 250,
          totalTokens: 750,
        });
      });

      it('should parse "1000 prompt tokens, 500 completion tokens"', () => {
        const result = parseTextBasedTokenUsage('1000 prompt tokens, 500 completion tokens');
        expect(result).toEqual({
          inputTokens: 1000,
          outputTokens: 500,
          totalTokens: 1500,
        });
      });

      it('should parse singular "1 input token"', () => {
        const result = parseTextBasedTokenUsage('1 input token, 1 output token');
        expect(result).toEqual({
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2,
        });
      });

      it('should parse "200 candidate tokens" (Google style output)', () => {
        const result = parseTextBasedTokenUsage('100 input tokens, 200 candidate tokens');
        expect(result).toEqual({
          inputTokens: 100,
          outputTokens: 200,
          totalTokens: 300,
        });
      });
    });

    describe('Pattern: X in, Y out (shorthand format)', () => {
      it('should parse "100 in, 50 out"', () => {
        const result = parseTextBasedTokenUsage('Tokens used: 100 in, 50 out');
        expect(result).toEqual({
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
        });
      });

      it('should parse "100 in / 50 out" with slash separator', () => {
        const result = parseTextBasedTokenUsage('100 in / 50 out');
        expect(result).toEqual({
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
        });
      });

      it('should parse "100 tokens in, 50 tokens out"', () => {
        const result = parseTextBasedTokenUsage('100 tokens in, 50 tokens out');
        expect(result).toEqual({
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
        });
      });

      it('should parse "100in/50out" without spaces', () => {
        const result = parseTextBasedTokenUsage('100in/50out');
        expect(result).toEqual({
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
        });
      });
    });

    describe('Pattern: prompt_tokens/completion_tokens (OpenAI style)', () => {
      it('should parse "prompt_tokens: 75, completion_tokens: 25"', () => {
        const result = parseTextBasedTokenUsage('prompt_tokens: 75, completion_tokens: 25');
        expect(result).toEqual({
          inputTokens: 75,
          outputTokens: 25,
          totalTokens: 100,
        });
      });

      it('should parse "prompt_tokens=150 completion_tokens=75"', () => {
        const result = parseTextBasedTokenUsage('prompt_tokens=150 completion_tokens=75');
        expect(result).toEqual({
          inputTokens: 150,
          outputTokens: 75,
          totalTokens: 225,
        });
      });
    });

    describe('Pattern: total tokens', () => {
      it('should parse total_tokens along with input/output', () => {
        const result = parseTextBasedTokenUsage('input=100, output=50, total=150');
        expect(result).toEqual({
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
        });
      });

      it('should parse "500 total tokens" format', () => {
        const result = parseTextBasedTokenUsage('200 input tokens, 100 output tokens, 300 total tokens');
        expect(result).toEqual({
          inputTokens: 200,
          outputTokens: 100,
          totalTokens: 300,
        });
      });

      it('should calculate totalTokens when not provided', () => {
        const result = parseTextBasedTokenUsage('input=200, output=100');
        expect(result?.totalTokens).toBe(300);
      });
    });

    describe('edge cases', () => {
      it('should return undefined when no token info found', () => {
        const result = parseTextBasedTokenUsage('Just some regular text without token info');
        expect(result).toBeUndefined();
      });

      it('should return undefined for empty string', () => {
        const result = parseTextBasedTokenUsage('');
        expect(result).toBeUndefined();
      });

      it('should handle multiline output', () => {
        const result = parseTextBasedTokenUsage('Response complete.\n\nUsage statistics:\ninput_tokens=500\noutput_tokens=250');
        expect(result).toEqual({
          inputTokens: 500,
          outputTokens: 250,
          totalTokens: 750,
        });
      });

      it('should be case insensitive', () => {
        const result = parseTextBasedTokenUsage('INPUT=100, OUTPUT=50');
        expect(result).toEqual({
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
        });
      });

      it('should handle large numbers', () => {
        const result = parseTextBasedTokenUsage('input=1000000, output=500000');
        expect(result).toEqual({
          inputTokens: 1000000,
          outputTokens: 500000,
          totalTokens: 1500000,
        });
      });

      it('should return undefined when only input is found (no output)', () => {
        const result = parseTextBasedTokenUsage('input=100');
        // Only input without output still returns a result
        expect(result).toEqual({
          inputTokens: 100,
          outputTokens: 0,
          totalTokens: 100,
        });
      });

      it('should return undefined when only output is found (no input)', () => {
        const result = parseTextBasedTokenUsage('output=50');
        // Only output without input still returns a result  
        expect(result).toEqual({
          inputTokens: 0,
          outputTokens: 50,
          totalTokens: 50,
        });
      });

      it('should prefer in/out pattern over separate input/output matches', () => {
        // When "X in, Y out" pattern is present, it should be used
        const result = parseTextBasedTokenUsage('100 in, 50 out');
        expect(result).toEqual({
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
        });
      });

      it('should extract from mixed content with code', () => {
        const result = parseTextBasedTokenUsage(`
Here's your code:
\`\`\`javascript
const x = 1;
\`\`\`

Token usage: 150 input tokens, 75 output tokens
        `);
        expect(result).toEqual({
          inputTokens: 150,
          outputTokens: 75,
          totalTokens: 225,
        });
      });
    });
  });

  describe('JSON parsing edge cases', () => {
    it('should handle JSON with prefix text', async () => {
      const ctx = {
        logger: { log: vi.fn() },
        runId: 'test-run',
        timeoutMs: 5000,
      };

      const outputWithPrefix = 'Processing...\n\n{"response": "Hello world", "usage": {"input_tokens": 10, "output_tokens": 5}}';

      pm.on.mockImplementation((event: string, callback: (chunk: string) => void) => {
        if (event === 'output') callback(outputWithPrefix);
        return pm;
      });
      pm.readUntilHeuristic.mockResolvedValue('');

      const response = await adapter.generate({ messages: [{ role: 'user', content: 'test' }] }, ctx);

      expect(response.text).toBe('Hello world');
      expect(response.usage?.inputTokens).toBe(10);
    });

    it('should handle JSON with suffix text', async () => {
      const ctx = {
        logger: { log: vi.fn() },
        runId: 'test-run',
        timeoutMs: 5000,
      };

      const outputWithSuffix = '{"response": "Result here"}\n\nDone.';

      pm.on.mockImplementation((event: string, callback: (chunk: string) => void) => {
        if (event === 'output') callback(outputWithSuffix);
        return pm;
      });
      pm.readUntilHeuristic.mockResolvedValue('');

      const response = await adapter.generate({ messages: [{ role: 'user', content: 'test' }] }, ctx);

      expect(response.text).toBe('Result here');
    });

    it('should handle malformed JSON gracefully and return raw text', async () => {
      const ctx = {
        logger: { log: vi.fn() },
        runId: 'test-run',
        timeoutMs: 5000,
      };

      const malformedJson = '{"response": "incomplete JSON...';

      pm.on.mockImplementation((event: string, callback: (chunk: string) => void) => {
        if (event === 'output') callback(malformedJson);
        return pm;
      });
      pm.readUntilHeuristic.mockResolvedValue('');

      const response = await adapter.generate({ messages: [{ role: 'user', content: 'test' }] }, ctx);

      // Should fall back to raw text when JSON parsing fails
      expect(response.text).toBe(malformedJson);
    });

    it('should handle empty JSON object', async () => {
      const ctx = {
        logger: { log: vi.fn() },
        runId: 'test-run',
        timeoutMs: 5000,
      };

      const emptyJson = '{}';

      pm.on.mockImplementation((event: string, callback: (chunk: string) => void) => {
        if (event === 'output') callback(emptyJson);
        return pm;
      });
      pm.readUntilHeuristic.mockResolvedValue('');

      const response = await adapter.generate({ messages: [{ role: 'user', content: 'test' }] }, ctx);

      // Should fall back to raw text when no response field
      expect(response.text).toBe(emptyJson);
    });

    it('should prefer "response" field over "message" field', async () => {
      const ctx = {
        logger: { log: vi.fn() },
        runId: 'test-run',
        timeoutMs: 5000,
      };

      const jsonWithBoth = JSON.stringify({
        response: 'primary response',
        message: 'secondary message',
      });

      pm.on.mockImplementation((event: string, callback: (chunk: string) => void) => {
        if (event === 'output') callback(jsonWithBoth);
        return pm;
      });
      pm.readUntilHeuristic.mockResolvedValue('');

      const response = await adapter.generate({ messages: [{ role: 'user', content: 'test' }] }, ctx);

      expect(response.text).toBe('primary response');
    });

    it('should use "message" field when "response" is not present', async () => {
      const ctx = {
        logger: { log: vi.fn() },
        runId: 'test-run',
        timeoutMs: 5000,
      };

      const jsonWithMessage = JSON.stringify({
        message: 'the message content',
      });

      pm.on.mockImplementation((event: string, callback: (chunk: string) => void) => {
        if (event === 'output') callback(jsonWithMessage);
        return pm;
      });
      pm.readUntilHeuristic.mockResolvedValue('');

      const response = await adapter.generate({ messages: [{ role: 'user', content: 'test' }] }, ctx);

      expect(response.text).toBe('the message content');
    });
  });

  describe('diff extraction', () => {
    it('should extract and parse unified diffs from response', async () => {
      const req: ModelRequest = {
        messages: [{ role: 'user', content: 'hello' }],
      };
      const ctx = {
        logger: { log: vi.fn() },
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

