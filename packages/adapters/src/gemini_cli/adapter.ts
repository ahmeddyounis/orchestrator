import {
  SubprocessProviderAdapter,
  parseUnifiedDiffFromText,
  parsePlanFromText,
} from '../subprocess';
import {
  ProviderConfig,
  ModelRequest,
  ModelResponse,
  ProviderCapabilities,
} from '@orchestrator/shared';
import { AdapterContext } from '../types';
import { ConfigError } from '../errors';

/**
 * Extended config options for GeminiCli provider.
 * These are passed through ProviderConfigSchema.passthrough().
 */
export interface GeminiCliConfig extends ProviderConfig {
  pty?: boolean;
}

type GeminiCliJson = {
  response?: unknown;
  stats?: unknown;
};

export class GeminiCliAdapter extends SubprocessProviderAdapter {
  constructor(config: GeminiCliConfig) {
    if (!config.model) {
      throw new ConfigError('GeminiCli provider requires a model to be specified in config.model.');
    }

    const command = config.command ? [config.command] : ['gemini'];
    const args = config.args || [];
    const pty = config.pty ?? false;
    const timeoutMs = config.timeoutMs;

    // We manage these flags to keep the subprocess output machine-parseable.
    assertDoesNotIncludeAnyArg(args, ['-o', '--output-format', '-m', '--model', '-p', '--prompt']);

    if (!command.length) {
      throw new ConfigError(`Missing command for GeminiCli provider. Checked config.command`);
    }

    // Gemini CLI reads additional context from stdin and uses `--prompt` as the query.
    // We send the full Orchestrator prompt on stdin to avoid argv length limits.
    super({
      command: [
        ...command,
        ...args,
        '--output-format',
        'json',
        '--model',
        config.model,
        '--prompt',
        'Follow the instructions and input provided on stdin. Reply with only the final answer.',
      ],
      cwdMode: 'repoRoot',
      envAllowlist: config.env,
      endInputAfterWrite: true,
      pty,
      timeoutMs,
    });
  }

  id(): string {
    return 'gemini_cli';
  }

  override capabilities(): ProviderCapabilities {
    return {
      supportsStreaming: false,
      supportsToolCalling: false,
      supportsJsonMode: false,
      modality: 'text',
      latencyClass: 'slow',
      configRequirements: {
        forbiddenArgs: ['-o', '--output-format', '-m', '--model', '-p', '--prompt'],
        supportedFields: {
          pty: {
            description: 'Spawn subprocess in a pseudo-terminal',
            type: 'boolean',
            default: false,
          },
        },
      },
    };
  }

  async generate(req: ModelRequest, ctx: AdapterContext): Promise<ModelResponse> {
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

    const raw = await super.generate(wrappedReq, ctx);
    const rawText = raw.text ?? '';

    const parsed = parseGeminiCliJson(rawText);
    const responseText = typeof parsed?.response === 'string' ? parsed.response : rawText;

    const usage = parsed ? (extractUsageFromStats(parsed.stats) ?? raw.usage) : raw.usage;

    // Extract diff if present using robust parser
    if (responseText) {
      const diffParsed = parseUnifiedDiffFromText(responseText);
      if (diffParsed && diffParsed.confidence >= 0.7) {
        await ctx.logger.log({
          schemaVersion: 1,
          timestamp: new Date().toISOString(),
          runId: ctx.runId,
          type: 'SubprocessParsed',
          payload: { kind: 'diff', confidence: diffParsed.confidence },
        });

        return {
          ...raw,
          text: diffParsed.diffText,
          usage,
          raw: parsed ?? raw.raw,
        };
      }

      const planParsed = parsePlanFromText(responseText);
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
      ...raw,
      text: responseText,
      usage,
      raw: parsed ?? raw.raw,
    };
  }
}

export function parseGeminiCliJson(text: string): GeminiCliJson | null {
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }

  try {
    return JSON.parse(text.slice(firstBrace, lastBrace + 1)) as GeminiCliJson;
  } catch (err) {
    console.debug(
      '[GeminiCliAdapter] Failed to parse JSON from output:',
      err,
      'slice:',
      text.slice(firstBrace, Math.min(firstBrace + 200, lastBrace + 1)),
    );
    return null;
  }
}

export function extractUsageFromStats(
  stats: unknown,
): { inputTokens: number; outputTokens: number; totalTokens?: number } | undefined {
  if (!stats || typeof stats !== 'object') return undefined;

  // Gemini CLI can report multiple models; sum them.
  const models = (stats as { models?: unknown }).models;
  if (!models || typeof models !== 'object') return undefined;

  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;

  for (const model of Object.values(models as Record<string, unknown>)) {
    if (!model || typeof model !== 'object') continue;
    const tokens = (model as { tokens?: unknown }).tokens;
    if (!tokens || typeof tokens !== 'object') continue;

    const prompt = numberOrZero((tokens as { prompt?: unknown }).prompt);
    const input = numberOrZero((tokens as { input?: unknown }).input);
    const candidates = numberOrZero((tokens as { candidates?: unknown }).candidates);
    const total = numberOrZero((tokens as { total?: unknown }).total);

    inputTokens += prompt || input;
    outputTokens += candidates;
    totalTokens += total || (prompt || input) + candidates;
  }

  if (inputTokens === 0 && outputTokens === 0 && totalTokens === 0) return undefined;

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
        `GeminiCli provider manages ${forbidden.join(', ')} internally; remove '${arg}' from config.args.`,
      );
    }
  }
}
