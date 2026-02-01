"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClaudeCodeAdapter = void 0;
const subprocess_1 = require("../subprocess");
const errors_1 = require("../errors");
class ClaudeCodeAdapter extends subprocess_1.SubprocessProviderAdapter {
    constructor(config) {
        const command = config.command ? [config.command] : ['claude'];
        const args = config.args || [];
        if (!command.length) {
            throw new errors_1.ConfigError(`Missing command for ClaudeCode provider. Checked config.command`);
        }
        super({
            command: [...command, ...args],
            cwdMode: 'repoRoot', // Enforce repoRoot
            envAllowlist: config.env,
        });
    }
    id() {
        return 'claude_code';
    }
    isPrompt(text) {
        return text.trim().endsWith('Claude>');
    }
    async generate(req, ctx) {
        // Inject prompt wrapper
        const systemMessage = {
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
`,
        };
        const wrappedReq = {
            ...req,
            messages: [...req.messages, systemMessage],
        };
        const response = await super.generate(wrappedReq, ctx);
        // Extract diff if present using robust parser
        if (response.text) {
            const diffParsed = (0, subprocess_1.parseUnifiedDiffFromText)(response.text);
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
            const planParsed = (0, subprocess_1.parsePlanFromText)(response.text);
            if (planParsed) {
                await ctx.logger.log({
                    schemaVersion: 1,
                    timestamp: new Date().toISOString(),
                    runId: ctx.runId,
                    type: 'SubprocessParsed',
                    payload: { kind: 'plan', confidence: planParsed.confidence },
                });
            }
            else {
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
exports.ClaudeCodeAdapter = ClaudeCodeAdapter;
