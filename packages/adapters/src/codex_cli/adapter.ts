import {
  SubprocessProviderAdapter,
  parseUnifiedDiffFromText,
  parsePlanFromText,
} from '../subprocess';
import { ProviderConfig, ModelRequest, ModelResponse } from '@orchestrator/shared';
import { AdapterContext } from '../types';
import { ConfigError } from '../errors';

export class CodexCliAdapter extends SubprocessProviderAdapter {
  constructor(config: ProviderConfig) {
    const command = config.command ? [config.command] : ['codex'];
    const args = config.args || [];
    const pty = (config as unknown as { pty?: boolean }).pty ?? false;
    const timeoutMs = config.timeoutMs;

    if (!command.length) {
      throw new ConfigError(`Missing command for CodexCli provider. Checked config.command`);
    }

    super({
      command: [...command, ...args],
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

