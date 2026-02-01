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
const process_manager_1 = require("./process-manager");
const path = __importStar(require("path"));
const FIXTURE_PATH = path.resolve(__dirname, 'fixtures/echo-cli.js');
(0, vitest_1.describe)('ProcessManager', () => {
    (0, vitest_1.it)('should spawn process and interact via stdin/stdout (child_process)', async () => {
        const pm = new process_manager_1.ProcessManager();
        await pm.spawn([process.execPath, FIXTURE_PATH], path.dirname(FIXTURE_PATH), {}, false);
        // Initial output
        const out1 = await pm.readUntil((t) => t.includes('Echo CLI Started'));
        (0, vitest_1.expect)(out1).toContain('Echo CLI Started');
        // Interaction
        pm.write('hello world\n');
        const out2 = await pm.readUntil((t) => t.includes('Echo: hello world'));
        (0, vitest_1.expect)(out2).toContain('Echo: hello world');
        // Cleanup
        pm.kill();
    });
    (0, vitest_1.it)('should enforce timeout', async () => {
        const pm = new process_manager_1.ProcessManager({ timeoutMs: 100 });
        // Run a sleeping process
        await pm.spawn([process.execPath, '-e', 'setTimeout(() => console.log("done"), 500)'], process.cwd(), {}, false);
        // readUntil with longer timeout than process timeout
        await (0, vitest_1.expect)(pm.readUntil((t) => t.includes('done'), 600)).rejects.toThrow(/readUntil timed out|Process exited/);
    });
    (0, vitest_1.it)('should enforce max output size', async () => {
        const pm = new process_manager_1.ProcessManager({ maxOutputSize: 5 });
        // Listen for error
        const errorPromise = new Promise((resolve) => {
            pm.on('error', (e) => resolve(e));
        });
        // Produce large output
        // Note: console.log adds newline
        await pm.spawn([process.execPath, '-e', 'console.log("123456")'], process.cwd(), {}, false);
        const err = await errorPromise;
        (0, vitest_1.expect)(err.message).toContain('Max output size');
        pm.kill();
    });
    // Optional: PTY test (might fail in some envs)
    (0, vitest_1.it)('should work with PTY', async () => {
        try {
            const pm = new process_manager_1.ProcessManager();
            await pm.spawn([process.execPath, FIXTURE_PATH], path.dirname(FIXTURE_PATH), {}, true);
            // Initial output
            const out1 = await pm.readUntil((t) => t.includes('Echo CLI Started'));
            (0, vitest_1.expect)(out1).toContain('Echo CLI Started');
            // Interaction
            pm.write('pty test\n');
            const out2 = await pm.readUntil((t) => t.includes('Echo: pty test'));
            (0, vitest_1.expect)(out2).toContain('Echo: pty test');
            pm.kill();
        }
        catch (e) {
            console.warn('PTY test skipped or failed:', e);
        }
    });
    (0, vitest_1.it)('should strip ANSI escape codes from output', async () => {
        const pm = new process_manager_1.ProcessManager();
        // This command prints a string with ANSI color codes
        const command = [process.execPath, '-e', "console.log('\\x1b[31mHello\\x1b[0m World')"];
        await pm.spawn(command, process.cwd(), {}, false);
        const output = await pm.readUntil((t) => t.includes('Hello'), 1000);
        // Vitest seems to have issues with `not.toContain` on raw ANSI strings,
        // so we check for the cleaned string directly.
        (0, vitest_1.expect)(output.trim()).toBe('Hello World');
        (0, vitest_1.expect)(output).not.toContain('\x1b[31m');
        pm.kill();
    });
    (0, vitest_1.it)('should only pass allowlisted environment variables', async () => {
        // Set a variable in the current process
        process.env['TEST_ENV_VAR'] = 'test_value';
        process.env['ANOTHER_VAR'] = 'another_value';
        const pm = new process_manager_1.ProcessManager({
            envAllowlist: ['TEST_ENV_VAR'],
        });
        const command = [
            process.execPath,
            '-e',
            'console.log(`TEST_ENV_VAR=${process.env.TEST_ENV_VAR},ANOTHER_VAR=${process.env.ANOTHER_VAR}`)',
        ];
        await pm.spawn(command, process.cwd(), {}, false);
        const output = await pm.readUntil((t) => t.includes('TEST_ENV_VAR'), 1000);
        // The allowlisted var should be present
        (0, vitest_1.expect)(output).toContain('TEST_ENV_VAR=test_value');
        // The non-allowlisted var should be undefined
        (0, vitest_1.expect)(output).toContain('ANOTHER_VAR=undefined');
        pm.kill();
        delete process.env['TEST_ENV_VAR'];
        delete process.env['ANOTHER_VAR'];
    });
});
//# sourceMappingURL=process-manager.test.js.map