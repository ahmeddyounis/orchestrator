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
const path = __importStar(require("path"));
const fs = __importStar(require("fs/promises"));
const adapter_1 = require("./adapter");
const process_manager_1 = require("./process-manager");
const FAKE_CLI_PATH = path.resolve(__dirname, 'fixtures/fake-agent-cli.js');
(0, vitest_1.describe)('Subprocess Integration', () => {
    const mockLogger = {
        log: vitest_1.vi.fn(),
        debug: vitest_1.vi.fn(),
        info: vitest_1.vi.fn(),
        warn: vitest_1.vi.fn(),
        error: vitest_1.vi.fn(),
    };
    const ctx = {
        runId: 'test-run-id-integration',
        logger: mockLogger,
        timeoutMs: 5000,
    };
    const runDir = path.join(process.cwd(), '.orchestrator', 'runs', 'test-run-id-integration', 'tool_logs');
    (0, vitest_1.beforeEach)(async () => {
        await fs.mkdir(runDir, { recursive: true });
    });
    (0, vitest_1.afterEach)(async () => {
        try {
            await fs.rm(runDir, { recursive: true, force: true });
        }
        catch {
            // ignore
        }
    });
    (0, vitest_1.it)('should handle basic interaction via Adapter', async () => {
        const adapter = new adapter_1.SubprocessProviderAdapter({
            command: [process.execPath, FAKE_CLI_PATH],
        });
        const req = {
            messages: [{ role: 'user', content: 'hello world' }],
        };
        const response = await adapter.generate(req, ctx);
        (0, vitest_1.expect)(response.text).toContain('You said: hello world');
    });
    (0, vitest_1.it)('should timeout when CLI is too slow', async () => {
        const adapter = new adapter_1.SubprocessProviderAdapter({
            command: [process.execPath, FAKE_CLI_PATH, '--slow'],
        });
        const shortCtx = { ...ctx, timeoutMs: 1000 };
        await (0, vitest_1.expect)(adapter.generate({ messages: [{ role: 'user', content: 'foo' }] }, shortCtx)).rejects.toThrow('Process timed out');
    });
    (0, vitest_1.it)('should timeout if end marker is missing', async () => {
        const adapter = new adapter_1.SubprocessProviderAdapter({
            command: [process.execPath, FAKE_CLI_PATH, '--no-end-marker'],
        });
        const shortCtx = { ...ctx, timeoutMs: 1500 };
        await (0, vitest_1.expect)(adapter.generate({ messages: [{ role: 'user', content: 'foo' }] }, shortCtx)).rejects.toThrow('Process timed out');
    });
    (0, vitest_1.it)('should enforce maxOutputSize via ProcessManager', async () => {
        const pm = new process_manager_1.ProcessManager({
            maxOutputSize: 50 * 1024,
            logger: mockLogger,
        });
        const resultPromise = new Promise((resolve, reject) => {
            pm.on('exit', () => resolve());
            pm.on('error', (err) => reject(err));
        });
        await pm.spawn([process.execPath, FAKE_CLI_PATH, '--large'], process.cwd(), {}, false);
        pm.write('trigger\n');
        await (0, vitest_1.expect)(resultPromise).rejects.toThrow('Max output size 51200 exceeded');
        pm.kill();
    });
});
//# sourceMappingURL=integration.test.js.map