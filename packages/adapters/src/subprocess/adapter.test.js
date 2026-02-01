"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const shared_1 = require("@orchestrator/shared");
const fs = __importStar(require("fs/promises"));
const adapter_1 = require("./adapter");
const FIXTURE_PATH = (0, shared_1.resolve)(__dirname, 'fixtures/echo-cli.js');
(0, vitest_1.describe)('SubprocessProviderAdapter', () => {
    const mockLogger = {
        log: vitest_1.vi.fn(),
        debug: vitest_1.vi.fn(),
        info: vitest_1.vi.fn(),
        warn: vitest_1.vi.fn(),
        error: vitest_1.vi.fn(),
    };
    const ctx = {
        runId: 'test-run-id',
        logger: mockLogger,
        timeoutMs: 5000,
    };
    const runDir = (0, shared_1.join)(process.cwd(), '.orchestrator', 'runs', 'test-run-id', 'tool_logs');
    (0, vitest_1.beforeEach)(async () => {
        await fs.mkdir(runDir, { recursive: true });
    });
    (0, vitest_1.afterEach)(async () => {
        // Cleanup if needed
        // await fs.rm(runDir, { recursive: true, force: true });
    });
    (0, vitest_1.it)('should generate text using echo-cli', async () => {
        const adapter = new adapter_1.SubprocessProviderAdapter({
            command: [process.execPath, FIXTURE_PATH],
        });
        const req = {
            messages: [{ role: 'user', content: 'hello world' }],
        };
        const response = await adapter.generate(req, ctx);
        // echo-cli prints:
        // Echo CLI Started
        // >
        // (wait)
        // Echo: hello world
        // >
        (0, vitest_1.expect)(response.text).toContain('Echo: hello world');
        // Check if log file was created
        const logPath = (0, shared_1.join)(runDir, 'subprocess_subprocess.log');
        const logContent = await fs.readFile(logPath, 'utf-8');
        (0, vitest_1.expect)(logContent).toContain('hello world');
    });
    (0, vitest_1.it)('should handle config env allowlist', async () => {
        // We can't easily test env isolation with echo-cli unless we modify it to print env.
        // But we trust ProcessManager test for logic, or we can use `node -e "console.log(process.env.FOO)"`
        const adapter = new adapter_1.SubprocessProviderAdapter({
            command: [
                process.execPath,
                '-e',
                'console.log(process.env.TEST_VAR || "MISSING"); console.log("> ");',
            ],
            envAllowlist: ['TEST_VAR'],
        });
        // Set env in process
        process.env.TEST_VAR = 'found';
        process.env.OTHER_VAR = 'should_not_be_seen';
        const req = {
            messages: [],
        };
        const response = await adapter.generate(req, ctx);
        (0, vitest_1.expect)(response.text).toContain('found');
        delete process.env.TEST_VAR;
        delete process.env.OTHER_VAR;
    });
    (0, vitest_1.it)('should truncate oversized transcripts', async () => {
        const adapter = new adapter_1.SubprocessProviderAdapter({
            command: [process.execPath, '-e', "console.log('A'.repeat(100)); console.log('> ');"],
            maxTranscriptSize: 50,
        });
        const req = {
            messages: [{ role: 'user', content: '' }], // Empty prompt
        };
        const response = await adapter.generate(req, ctx);
        (0, vitest_1.expect)(response.text?.length).toBeLessThanOrEqual(50);
        (0, vitest_1.expect)(response.text).toContain('TRUNCATED');
        // Check that we have the tail end of the 'A's
        (0, vitest_1.expect)(response.text?.endsWith('A'.repeat(10))).toBe(false); // prompt is stripped
    });
});
//# sourceMappingURL=adapter.test.js.map