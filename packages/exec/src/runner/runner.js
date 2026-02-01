"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SafeCommandRunner = void 0;
const child_process_1 = require("child_process");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = require("crypto");
const shared_1 = require("@orchestrator/shared");
const parser_1 = require("../classify/parser");
class SafeCommandRunner {
    checkPolicy(req, policy) {
        // 1. Policy Check: Enabled
        if (!policy.enabled) {
            return {
                isAllowed: false,
                needsConfirmation: false,
                reason: 'Tool execution is disabled by policy',
            };
        }
        // 2. Policy Check: Denylist
        const isDenied = policy.denylistPatterns.some((pattern) => new RegExp(pattern).test(req.command));
        if (isDenied) {
            return {
                isAllowed: false,
                needsConfirmation: false,
                reason: `Command matched denylist pattern: ${req.command}`,
            };
        }
        // 3. Policy Check: Confirmation
        const isAllowlisted = policy.allowlistPrefixes.some((prefix) => req.command.startsWith(prefix));
        let needsConfirmation = policy.requireConfirmation;
        if (isAllowlisted) {
            needsConfirmation = false;
        }
        // Force confirmation for destructive commands unless explicitly allowlisted
        if (req.classification === 'destructive' && !isAllowlisted) {
            needsConfirmation = true;
        }
        // Auto-approve overrides confirmation needs (except denylist which is already checked)
        if (policy.autoApprove) {
            needsConfirmation = false;
        }
        return { isAllowed: true, needsConfirmation };
    }
    async run(req, policy, ui, ctx) {
        const policyResult = this.checkPolicy(req, policy);
        if (!policyResult.isAllowed) {
            throw new shared_1.UsageError(policyResult.reason || 'Command denied by policy');
        }
        if (policyResult.needsConfirmation) {
            // Check for non-interactive mode
            // Corresponds to --non-interactive flag
            if (policy.interactive === false) {
                throw new shared_1.UsageError(`Command execution denied in non-interactive mode: ${req.command}`);
            }
            const confirmed = await ui.confirm(`Execute command: ${req.command}`, `Reason: ${req.reason}\nCWD: ${req.cwd || ctx.cwd || process.cwd()}`);
            if (!confirmed) {
                throw new shared_1.UsageError(`User denied execution of: ${req.command}`);
            }
        }
        // 4. Execution Setup
        const runId = ctx.runId;
        const toolRunId = ctx.toolRunId || (0, crypto_1.randomUUID)();
        const projectRoot = process.cwd(); // Assuming root is CWD
        // Artifacts paths
        const runsDir = path_1.default.join(projectRoot, '.orchestrator', 'runs', runId, 'tool_logs');
        fs_1.default.mkdirSync(runsDir, { recursive: true });
        const stdoutPath = path_1.default.join(runsDir, `${toolRunId}_stdout.log`);
        const stderrPath = path_1.default.join(runsDir, `${toolRunId}_stderr.log`);
        // 5. Run Process
        return this.exec(req, policy, stdoutPath, stderrPath);
    }
    async exec(req, policy, stdoutPath, stderrPath) {
        const parsed = (0, parser_1.parseCommand)(req.command);
        if (!parsed.bin) {
            throw new shared_1.ToolError(`Could not parse command: ${req.command}`);
        }
        const stdoutStream = fs_1.default.createWriteStream(stdoutPath);
        const stderrStream = fs_1.default.createWriteStream(stderrPath);
        let stdoutBytes = 0;
        let stderrBytes = 0;
        let truncated = false;
        // Timer
        const start = Date.now();
        let timeoutTimer;
        return new Promise((resolve, reject) => {
            const child = (0, child_process_1.spawn)(parsed.bin, parsed.args, {
                cwd: req.cwd,
                env: { ...process.env, ...req.env },
                stdio: ['ignore', 'pipe', 'pipe'],
                shell: false,
                detached: true,
            });
            // Timeout handling
            timeoutTimer = setTimeout(() => {
                try {
                    if (child.pid) {
                        process.kill(-child.pid, 'SIGTERM');
                    }
                }
                catch {
                    // Ignore if already dead
                }
                const partialStdout = fs_1.default.readFileSync(stdoutPath, 'utf8').slice(0, 1000);
                const partialStderr = fs_1.default.readFileSync(stderrPath, 'utf8').slice(0, 1000);
                reject(new shared_1.ToolError(`Command timed out after ${policy.timeoutMs}ms`, {
                    details: { partialStdout, partialStderr },
                }));
            }, policy.timeoutMs);
            // Output handling
            child.stdout.on('data', (chunk) => {
                if (truncated)
                    return;
                stdoutBytes += chunk.length;
                if (stdoutBytes + stderrBytes > policy.maxOutputBytes) {
                    truncated = true;
                    stdoutStream.write(chunk.slice(0, Math.max(0, policy.maxOutputBytes - (stdoutBytes - chunk.length) - stderrBytes)));
                    stdoutStream.write('\n[Output truncated due to limit]\n');
                    // Kill process
                    try {
                        if (child.pid) {
                            process.kill(-child.pid, 'SIGTERM');
                        }
                    }
                    catch {
                        /* ignore */
                    }
                }
                else {
                    stdoutStream.write(chunk);
                }
            });
            child.stderr.on('data', (chunk) => {
                if (truncated)
                    return;
                stderrBytes += chunk.length;
                if (stdoutBytes + stderrBytes > policy.maxOutputBytes) {
                    truncated = true;
                    stderrStream.write(chunk.slice(0, Math.max(0, policy.maxOutputBytes - (stderrBytes - chunk.length) - stdoutBytes)));
                    stderrStream.write('\n[Output truncated due to limit]\n');
                    // Kill process
                    try {
                        if (child.pid) {
                            process.kill(-child.pid, 'SIGTERM');
                        }
                    }
                    catch {
                        /* ignore */
                    }
                }
                else {
                    stderrStream.write(chunk);
                }
            });
            child.on('error', (err) => {
                clearTimeout(timeoutTimer);
                stdoutStream.end();
                stderrStream.end();
                reject(new shared_1.ToolError(`Failed to start process: ${err.message}`));
            });
            child.on('close', (code) => {
                clearTimeout(timeoutTimer);
                stdoutStream.end();
                stderrStream.end();
                const durationMs = Date.now() - start;
                resolve({
                    exitCode: code ?? -1,
                    durationMs,
                    stdoutPath,
                    stderrPath,
                    truncated,
                });
            });
        });
    }
}
exports.SafeCommandRunner = SafeCommandRunner;
//# sourceMappingURL=runner.js.map