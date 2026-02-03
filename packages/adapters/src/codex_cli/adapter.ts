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

    // Extract diff if present using robust parser
    if (response.text) {
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

    return response;
  }
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

