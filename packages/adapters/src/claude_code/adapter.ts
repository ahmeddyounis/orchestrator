import {
  SubprocessProviderAdapter,
  parseUnifiedDiffFromText,
  parsePlanFromText,
} from '../subprocess';
import { ProviderConfig, ModelRequest, ModelResponse } from '@orchestrator/shared';
import { AdapterContext } from '../types';
import { ConfigError } from '../errors';

export class ClaudeCodeAdapter extends SubprocessProviderAdapter {
  constructor(config: ProviderConfig) {
    const command = config.command ? [config.command] : ['claude'];
    const args = config.args || [];
    const pty = (config as unknown as { pty?: boolean }).pty ?? false;
    const timeoutMs = config.timeoutMs;

    // Prefer non-interactive mode for programmatic use (works well with pipes).
    // Claude Code reads the prompt from stdin when `--print` is enabled.
    const printArgs = args.includes('-p') || args.includes('--print') ? args : ['--print', ...args];

    if (!command.length) {
      throw new ConfigError(`Missing command for ClaudeCode provider. Checked config.command`);
    }

    super({
      command: [...command, ...printArgs],
      cwdMode: 'repoRoot', // Enforce repoRoot
      envAllowlist: config.env,
      endInputAfterWrite: true,
      pty,
      timeoutMs,
    });
  }

  id(): string {
    return 'claude_code';
  }

  protected override isPrompt(text: string): boolean {
    return text.trim().endsWith('Claude>');
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
        // Emit diff parsed event
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

      // Fallback: Check for plan or just text
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
