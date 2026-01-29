import { SubprocessProviderAdapter } from '../subprocess';
import { ProviderConfig, ModelRequest, ModelResponse, ChatMessage } from '@orchestrator/shared';
import { AdapterContext } from '../types';

export class ClaudeCodeAdapter extends SubprocessProviderAdapter {
  constructor(config: ProviderConfig) {
    const command = config.command ? [config.command] : ['claude'];
    const args = config.args || [];
    
    super({
      command: [...command, ...args],
      cwdMode: 'repoRoot', // Enforce repoRoot
      env: config.env,
    });
  }

  id(): string {
    return 'claude_code';
  }

  async generate(req: ModelRequest, ctx: AdapterContext): Promise<ModelResponse> {
    // Inject prompt wrapper
    const systemMessage: ChatMessage = {
      role: 'system',
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
`
    };

    const wrappedReq = {
      ...req,
      messages: [
        ...req.messages,
        systemMessage
      ]
    };

    const response = await super.generate(wrappedReq, ctx);
    
    // Extract diff if present
    if (response.text) {
      const diffMatch = response.text.match(/<BEGIN_DIFF>([\s\S]*?)<END_DIFF>/);
      if (diffMatch) {
        return {
          ...response,
          text: diffMatch[1].trim()
        };
      }
    }

    return response;
  }
}
