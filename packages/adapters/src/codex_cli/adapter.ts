import {
  SubprocessProviderAdapter,
  parseUnifiedDiffFromText,
  parsePlanFromText,
} from '../subprocess';
import { ProviderConfig, ModelRequest, ModelResponse } from '@orchestrator/shared';
import { AdapterContext } from '../types';
import { ConfigError } from '../errors';

/**
 * Extended config options for CodexCli provider.
 * These are passed through ProviderConfigSchema.passthrough().
 */
interface CodexCliConfig extends ProviderConfig {
  pty?: boolean;
  /** Enable OSS mode with --oss and --local-provider flags for local model usage */
  ossMode?: boolean;
}

/**
 * Shape of Codex CLI JSON output when using --json flag.
 * Similar to GeminiCliJson but with Codex-specific fields.
 */
type CodexCliJson = {
  response?: unknown;
  message?: unknown;
  usage?: unknown;
  stats?: unknown;
};

/**
 * Pattern to detect Codex CLI prompt markers.
 * Matches common interactive prompt styles:
 * - "codex>" or "Codex>" (Codex CLI default)
 * - "> " at end of line (minimal shell prompt)
 * - ">>> " (Python REPL style)
 * - "$ " at end of line (shell style)
 *
 * The pattern is case-insensitive for "codex" to handle variations.
 */
const CODEX_PROMPT_PATTERN = /(?:codex>|>\s*$|>>>\s*$|\$\s*$)/i;

export class CodexCliAdapter extends SubprocessProviderAdapter {
  constructor(config: ProviderConfig) {
    const codexConfig = config as CodexCliConfig;
    const command = config.command ? [config.command] : ['codex'];
    const args = config.args || [];
    const pty = codexConfig.pty ?? false;
    const timeoutMs = config.timeoutMs;
    const ossMode = codexConfig.ossMode ?? false;

    // We manage these flags to keep the subprocess output machine-parseable.
    // Also forbid OSS-related flags since we control them via ossMode config.
    assertDoesNotIncludeAnyArg(args, ['exec', '-m', '--model', '--json', '--output-schema', '-']);

    if (!command.length) {
      throw new ConfigError(`Missing command for CodexCli provider. Checked config.command`);
    }

    super({
      command: [
        ...command,
        ...(ossMode ? ['--oss', '--local-provider', config.model] : []),
        'exec',
        ...args,
        '--color',
        'never',
        '--sandbox',
        'read-only',
        '--model',
        config.model,
        '-',
      ],
      cwdMode: 'repoRoot',
      envAllowlist: config.env,
      endInputAfterWrite: true,
      pty,
      timeoutMs,
    });
  }

  id(): string {
    return 'codex_cli';
  }

  /**
   * Detects if text indicates Codex CLI is waiting for input.
   * Recognizes patterns like "codex>", "> ", ">>> ", or "$ " at end of text.
   */
  protected override isPrompt(text: string): boolean {
    const trimmed = text.trim();
    // Check for "codex>" anywhere in the last line, or shell-style prompts at the end
    const lastLine = trimmed.split('\n').pop() ?? '';
    return CODEX_PROMPT_PATTERN.test(lastLine);
  }

  async generate(req: ModelRequest, ctx: AdapterContext): Promise<ModelResponse> {
    // Only enforce diff output when we're not explicitly requesting JSON.
    // Planning/review/diagnose steps use `jsonMode` and should not be forced into diff formatting.
    const shouldEnforceDiffOutput = !req.jsonMode;

    const wrappedReq = shouldEnforceDiffOutput
      ? {
          ...req,
          messages: [
            ...req.messages,
            {
              role: 'system' as const,
              content: `IMPORTANT: When providing code changes, you MUST output a unified diff enclosed in the tag 'BEGIN_DIFF' and 'END_DIFF' (wrapped in angle brackets).
Example:
<BEGIN_DIFF>
diff --git a/file.ts b/file.ts
index 1234567..89abcdef 100644
--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,3 @@
-const x = 1;
+const x = 2;
<END_DIFF>
`,
            },
          ],
        }
      : req;

    const response = await super.generate(wrappedReq, ctx);
    const rawText = response.text ?? '';

    // Try to parse JSON output or text-based stats from Codex CLI
    const parsed = parseCodexCliJson(rawText);
    const responseText = extractResponseText(parsed, rawText);
    
    // Extract usage from JSON stats, text-based stats, or fall back to placeholder
    const usage = extractUsageFromCodexStats(parsed) ?? 
                  parseTextBasedTokenUsage(rawText) ?? 
                  response.usage;

    // Extract diff if present using robust parser
    if (responseText) {
      const diffParsed = parseUnifiedDiffFromText(response.text);
      if (diffParsed && diffParsed.confidence >= 0.7) {
        await ctx.logger.log({
          schemaVersion: 1,
          timestamp: new Date().toISOString(),
          runId: ctx.runId,
          type: 'SubprocessParsed',
          payload: { kind: 'diff', confidence: diffParsed.confidence },
        });

        return {
          ...response,
          text: diffParsed.diffText,
          usage,
          raw: parsed ?? response.raw,
        };
      }

      const planParsed = parsePlanFromText(response.text);
      if (planParsed) {
        await ctx.logger.log({
          schemaVersion: 1,
          timestamp: new Date().toISOString(),
          runId: ctx.runId,
          type: 'SubprocessParsed',
          payload: { kind: 'plan', confidence: planParsed.confidence },
        });
      } else {
        await ctx.logger.log({
          schemaVersion: 1,
          timestamp: new Date().toISOString(),
          runId: ctx.runId,
          type: 'SubprocessParsed',
          payload: { kind: 'text', confidence: 1.0 },
        });
      }
    }
    return {
      ...response,
      text: responseText,
      usage,
      raw: parsed ?? response.raw,
    };
  }
}

/**
 * Parses JSON output from Codex CLI.
 * Extracts the outermost JSON object from the text, handling any
 * prefix/suffix text that may surround the JSON.
 *
 * @param text - Raw output text from Codex CLI
 * @returns Parsed CodexCliJson object, or null if no valid JSON found
 */
function parseCodexCliJson(text: string): CodexCliJson | null {
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }

  try {
    return JSON.parse(text.slice(firstBrace, lastBrace + 1)) as CodexCliJson;
  } catch {
    return null;
  }
}

/**
 * Extracts the response text from parsed Codex CLI JSON.
 * Checks multiple possible field names that Codex CLI might use.
 */
function extractResponseText(parsed: CodexCliJson | null, fallback: string): string {
  if (!parsed) return fallback;

  // Try common response field names
  if (typeof parsed.response === 'string') return parsed.response;
  if (typeof parsed.message === 'string') return parsed.message;

  return fallback;
}

/**
 * Extracts usage/token statistics from Codex CLI JSON output.
 * Handles both 'usage' and 'stats' fields with various token count formats.
 */
export function extractUsageFromCodexStats(
  parsed: CodexCliJson,
): { inputTokens: number; outputTokens: number; totalTokens?: number } | undefined {
  const usage = parsed.usage ?? parsed.stats;
  if (!usage || typeof usage !== 'object') return undefined;

  const usageObj = usage as Record<string, unknown>;

  // Handle various token field naming conventions
  const inputTokens =
    numberOrZero(usageObj.input_tokens) ||
    numberOrZero(usageObj.inputTokens) ||
    numberOrZero(usageObj.prompt_tokens);
  const outputTokens =
    numberOrZero(usageObj.output_tokens) ||
    numberOrZero(usageObj.outputTokens) ||
    numberOrZero(usageObj.completion_tokens);
  const totalTokens =
    numberOrZero(usageObj.total_tokens) ||
    numberOrZero(usageObj.totalTokens) ||
    inputTokens + outputTokens;

  if (inputTokens === 0 && outputTokens === 0 && totalTokens === 0) return undefined;

  return {
    inputTokens,
    outputTokens,
    totalTokens: totalTokens || undefined,
  };
}

/**
 * Parses token usage from text-based output when JSON is not available.
 * Handles common patterns from CLI tools:
 * - "Tokens: input=123, output=456"
 * - "Usage: 123 input tokens, 456 output tokens"
 * - "Input tokens: 123\nOutput tokens: 456"
 * - "prompt_tokens: 123, completion_tokens: 456"
 * - "Tokens used: 123 in, 456 out"
 */
export function parseTextBasedTokenUsage(
  text: string,
): { inputTokens: number; outputTokens: number; totalTokens?: number } | undefined {
  // Pattern 1: "input=X" and "output=Y" or "input_tokens=X"
  const inputMatch = text.match(/(?:input|prompt)[_\s]*(?:tokens)?[=:\s]+(\d+)/i);
  const outputMatch = text.match(/(?:output|completion|candidate)[_\s]*(?:tokens)?[=:\s]+(\d+)/i);
  
  // Pattern 2: "X input tokens" and "Y output tokens"
  const inputMatch2 = text.match(/(\d+)\s+(?:input|prompt)\s+tokens?/i);
  const outputMatch2 = text.match(/(\d+)\s+(?:output|completion|candidate)\s+tokens?/i);
  
  // Pattern 3: "X in, Y out" or "X in / Y out"
  const inOutMatch = text.match(/(\d+)\s*(?:tokens?)?\s*in[,\/\s]+(\d+)\s*(?:tokens?)?\s*out/i);
  
  // Pattern 4: Total tokens line
  const totalMatch = text.match(/(?:total)[_\s]*(?:tokens)?[=:\s]+(\d+)/i);
  const totalMatch2 = text.match(/(\d+)\s+total\s+tokens?/i);
  
  let inputTokens = 0;
  let outputTokens = 0;
  
  if (inOutMatch) {
    inputTokens = parseInt(inOutMatch[1], 10);
    outputTokens = parseInt(inOutMatch[2], 10);
  } else {
    inputTokens = parseInt(inputMatch?.[1] ?? inputMatch2?.[1] ?? '0', 10);
    outputTokens = parseInt(outputMatch?.[1] ?? outputMatch2?.[1] ?? '0', 10);
  }
  
  const totalTokens = parseInt(totalMatch?.[1] ?? totalMatch2?.[1] ?? '0', 10) || 
                      (inputTokens + outputTokens) || 
                      undefined;
  
  if (inputTokens === 0 && outputTokens === 0) {
    return undefined;
  }
  
  return {
    inputTokens,
    outputTokens,
    totalTokens: totalTokens || undefined,
  };
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function assertDoesNotIncludeAnyArg(args: string[], forbidden: string[]): void {
  for (const arg of args) {
    if (forbidden.includes(arg)) {
      throw new ConfigError(
        `CodexCli provider manages ${forbidden.join(', ')} internally; remove '${arg}' from config.args.`,
      );
    }
  }
}

