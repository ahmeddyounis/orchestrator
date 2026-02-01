"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const adapter_1 = require("./adapter");
const process_manager_1 = require("../subprocess/process-manager");
const vitest_1 = require("vitest");
// Mock the ProcessManager
vitest_1.vi.mock('../subprocess/process-manager', () => {
    const ProcessManager = vitest_1.vi.fn();
    ProcessManager.prototype.spawn = vitest_1.vi.fn();
    ProcessManager.prototype.write = vitest_1.vi.fn();
    ProcessManager.prototype.kill = vitest_1.vi.fn();
    ProcessManager.prototype.on = vitest_1.vi.fn();
    ProcessManager.prototype.readUntilHeuristic = vitest_1.vi.fn();
    ProcessManager.prototype.isRunning = true;
    return { ProcessManager };
});
(0, vitest_1.describe)('ClaudeCodeAdapter', () => {
    let adapter;
    let pm;
    (0, vitest_1.beforeEach)(() => {
        adapter = new adapter_1.ClaudeCodeAdapter({
            type: 'claude_code',
            model: 'claude-v1',
            command: 'claude',
            args: ['--version', '1.0'],
        });
        pm = new process_manager_1.ProcessManager();
    });
    (0, vitest_1.afterEach)(() => {
        vitest_1.vi.clearAllMocks();
    });
    (0, vitest_1.it)('should send a wrapped prompt to the subprocess', async () => {
        const req = {
            messages: [{ role: 'user', content: 'hello' }],
        };
        const ctx = {
            logger: { log: vitest_1.vi.fn() },
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
        let outputCallback = () => { };
        pm.on.mockImplementation((event, callback) => {
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
        const sentInput = pm.write.mock.calls[0][0];
        (0, vitest_1.expect)(sentInput).toContain('IMPORTANT: When providing code changes');
        (0, vitest_1.expect)(sentInput).toContain('hello');
        // Check that the diff was parsed correctly
        (0, vitest_1.expect)(response.text).toContain('diff --git a/file.ts b/file.ts');
        (0, vitest_1.expect)(response.text).not.toContain('<BEGIN_DIFF>');
    });
});
//# sourceMappingURL=adapter.test.js.map