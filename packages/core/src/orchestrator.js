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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Orchestrator = void 0;
const shared_1 = require("@orchestrator/shared");
const repo_1 = require("@orchestrator/repo");
const memory_1 = require("@orchestrator/memory");
const patch_store_1 = require("./exec/patch_store");
const service_1 = require("./plan/service");
const service_2 = require("./exec/service");
const runner_1 = require("./verify/runner");
const memory_2 = require("./memory");
const path_1 = __importDefault(require("path"));
const promises_1 = __importDefault(require("fs/promises"));
const fsSync = __importStar(require("fs"));
const crypto_1 = require("crypto");
const budget_1 = require("./config/budget");
const loader_1 = require("./config/loader");
const context_1 = require("./context");
class ProceduralMemoryImpl {
    dbPath;
    repoId;
    constructor(dbPath, repoId) {
        this.dbPath = dbPath;
        this.repoId = repoId;
    }
    async find(queries, limit) {
        if (!this.dbPath) {
            return queries.map(() => []);
        }
        const store = (0, memory_1.createMemoryStore)();
        try {
            store.init(this.dbPath);
            const allProcedural = store.list(this.repoId, 'procedural');
            const results = [];
            for (const query of queries) {
                const filtered = allProcedural.filter((entry) => {
                    if (query.titleContains && !entry.title.includes(query.titleContains)) {
                        return false;
                    }
                    return true;
                });
                results.push(filtered.slice(0, limit));
            }
            return results;
        }
        finally {
            store.close();
        }
    }
}
class Orchestrator {
    config;
    git;
    registry;
    repoRoot;
    costTracker;
    toolPolicy;
    ui;
    suppressEpisodicMemoryWrite = false;
    constructor(options) {
        this.config = options.config;
        this.git = options.git;
        this.registry = options.registry;
        this.repoRoot = options.repoRoot;
        this.costTracker = options.costTracker;
        this.toolPolicy = options.toolPolicy;
        this.ui = options.ui;
    }
    async run(goal, options) {
        const runId = options.runId || Date.now().toString();
        // L1+ features below
        if (options.thinkLevel !== 'L0') {
            const artifacts = await (0, shared_1.createRunDir)(this.repoRoot, runId);
            const logger = new shared_1.JsonlLogger(artifacts.trace);
            const eventBus = {
                emit: async (e) => await logger.log(e),
            };
            await this.autoUpdateIndex(eventBus, runId);
        }
        if (options.thinkLevel === 'L0') {
            return this.runL0(goal, runId);
        }
        else if (options.thinkLevel === 'L2') {
            return this.runL2(goal, runId);
        }
        else {
            return this.runL1(goal, runId);
        }
    }
    async autoUpdateIndex(eventBus, runId) {
        const cfg = this.config.indexing;
        if (!this.config.memory?.enabled || !cfg?.enabled || !cfg.autoUpdateOnRun) {
            return;
        }
        try {
            const orchestratorConfig = {
                ...this.config,
                rootDir: this.repoRoot,
                orchestratorDir: path_1.default.join(this.repoRoot, '.orchestrator'),
            };
            const status = await (0, repo_1.getIndexStatus)(orchestratorConfig);
            if (!status.isIndexed) {
                // TODO: Could auto-build here based on config
                console.warn('Auto-update skipped: index does not exist.');
                return;
            }
            const drift = status.drift;
            if (!drift || !drift.hasDrift) {
                return; // No drift
            }
            const totalDrift = drift.addedCount + drift.removedCount + drift.changedCount;
            if (totalDrift > (cfg.maxAutoUpdateFiles ?? 5000)) {
                console.warn(`Index drift (${totalDrift} files) exceeds limit (${cfg.maxAutoUpdateFiles}). Skipping auto-update.`);
                return;
            }
            await eventBus.emit({
                type: 'IndexAutoUpdateStarted',
                schemaVersion: 1,
                runId,
                timestamp: new Date().toISOString(),
                payload: {
                    fileCount: totalDrift,
                    reason: 'Pre-run check detected drift.',
                },
            });
            const indexPath = path_1.default.join(this.repoRoot, cfg.path);
            const updater = new repo_1.IndexUpdater(indexPath);
            const result = await updater.update(this.repoRoot);
            await eventBus.emit({
                type: 'IndexAutoUpdateFinished',
                schemaVersion: 1,
                runId,
                timestamp: new Date().toISOString(),
                payload: {
                    filesAdded: result.added.length,
                    filesRemoved: result.removed.length,
                    filesChanged: result.changed.length,
                },
            });
            await eventBus.emit({
                type: 'MemoryStalenessReconciled',
                schemaVersion: 1,
                runId,
                timestamp: new Date().toISOString(),
                payload: {
                    details: 'Index updated, subsequent memory retrievals will use fresh data.',
                },
            });
        }
        catch (error) {
            console.warn('Auto-update of index failed:', error);
            // Non-fatal
        }
    }
    shouldWriteEpisodicMemory() {
        const mem = this.config.memory;
        return !!(mem?.enabled && mem?.writePolicy?.enabled && mem?.writePolicy?.storeEpisodes);
    }
    resolveMemoryDbPath() {
        const p = this.config.memory?.storage?.path;
        if (!p)
            return undefined;
        return path_1.default.isAbsolute(p) ? p : path_1.default.join(this.repoRoot, p);
    }
    toArtifactRelPath(p) {
        if (!path_1.default.isAbsolute(p))
            return p;
        const prefix = this.repoRoot.endsWith(path_1.default.sep) ? this.repoRoot : this.repoRoot + path_1.default.sep;
        if (!p.startsWith(prefix))
            return p;
        return path_1.default.relative(this.repoRoot, p);
    }
    collectArtifactPaths(runId, artifactsRoot, patchPaths = [], extraPaths = []) {
        const absPaths = [];
        const add = (p) => {
            if (!p)
                return;
            absPaths.push(p);
        };
        add(path_1.default.join(artifactsRoot, 'trace.jsonl'));
        add(path_1.default.join(artifactsRoot, 'summary.json'));
        add(path_1.default.join(artifactsRoot, 'manifest.json'));
        add(path_1.default.join(artifactsRoot, 'effective-config.json'));
        for (const p of patchPaths)
            add(p);
        for (const p of extraPaths)
            add(p);
        // Include any key run outputs and reports, plus patch/log artifacts.
        const root = artifactsRoot;
        const patchesDir = path_1.default.join(root, 'patches');
        const toolLogsDir = path_1.default.join(root, 'tool_logs');
        const addDirFiles = (dir, filter) => {
            if (!fsSync.existsSync(dir))
                return;
            for (const name of fsSync.readdirSync(dir)) {
                if (filter && !filter(name))
                    continue;
                const full = path_1.default.join(dir, name);
                try {
                    if (fsSync.statSync(full).isFile())
                        add(full);
                }
                catch {
                    /* ignore */
                }
            }
        };
        addDirFiles(patchesDir, (n) => n.endsWith('.patch'));
        addDirFiles(toolLogsDir);
        addDirFiles(root, (n) => n === 'executor_output.txt' ||
            /^step_.*_output\.txt$/.test(n) ||
            /^repair_iter_\d+_output\.txt$/.test(n) ||
            /^verification_report_.*\.json$/.test(n) ||
            /^verification_command_source.json$/.test(n) ||
            /^verification_summary_.*\.txt$/.test(n) ||
            /^failure_summary_iter_\d+\.(json|txt)$/.test(n) ||
            /^fused_context_.*\.(json|txt)$/.test(n));
        // De-dupe + relativize.
        return [...new Set(absPaths.map((p) => this.toArtifactRelPath(p)))];
    }
    async writeEpisodicMemory(summary, args, eventBus) {
        if (this.suppressEpisodicMemoryWrite || !this.shouldWriteEpisodicMemory())
            return;
        let gitSha = '';
        try {
            gitSha = await this.git.getHeadSha();
        }
        catch {
            gitSha = 'unknown';
        }
        const repoState = {
            gitSha,
            repoId: this.repoRoot,
            memoryDbPath: this.resolveMemoryDbPath(),
            artifactPaths: this.collectArtifactPaths(summary.runId, args.artifactsRoot, args.patchPaths ?? [], args.extraArtifactPaths ?? []),
        };
        try {
            const writer = new memory_2.MemoryWriter(eventBus, summary.runId);
            await writer.extractEpisodic({
                runId: summary.runId,
                goal: summary.goal ?? '',
                status: summary.status,
                stopReason: summary.stopReason ?? 'unknown',
            }, repoState, args.verificationReport);
        }
        catch {
            // Non-fatal: don't fail the run if memory persistence fails.
        }
    }
    async _buildRunSummary(runId, goal, startTime, status, options, runResult, artifacts) {
        const finishedAt = new Date();
        const patchStats = runResult.filesChanged
            ? {
                filesChanged: runResult.filesChanged.length,
                linesAdded: 0, // Note: Not easily available, default to 0
                linesDeleted: 0, // Note: Not easily available, default to 0
                finalDiffPath: runResult.patchPaths && runResult.patchPaths.length > 0
                    ? runResult.patchPaths[runResult.patchPaths.length - 1]
                    : undefined,
            }
            : undefined;
        const costSummary = this.costTracker?.getSummary();
        return {
            schemaVersion: 1,
            runId,
            command: ['run', goal],
            goal,
            repoRoot: this.repoRoot,
            repoId: this.repoRoot, // Consider a more stable repo ID
            startedAt: new Date(startTime).toISOString(),
            finishedAt: finishedAt.toISOString(),
            durationMs: finishedAt.getTime() - startTime,
            status,
            stopReason: runResult.stopReason,
            thinkLevel: parseInt(options.thinkLevel.slice(1), 10),
            selectedProviders: {
                planner: this.config.defaults?.planner || 'default',
                executor: this.config.defaults?.executor || 'default',
                reviewer: this.config.defaults?.reviewer,
            },
            budgets: {
                maxIterations: this.config.budget?.iter ?? budget_1.DEFAULT_BUDGET.iter,
                maxToolRuns: 999, // Not yet implemented
                maxWallTimeMs: this.config.budget?.time ?? budget_1.DEFAULT_BUDGET.time,
                maxCostUsd: this.config.budget?.cost,
            },
            patchStats,
            verification: runResult.verification
                ? {
                    enabled: runResult.verification.enabled,
                    passed: runResult.verification.passed,
                    failedChecks: runResult.verification.failedChecks?.length,
                    reportPaths: runResult.verification.reportPaths,
                }
                : undefined,
            tools: {
                enabled: this.toolPolicy !== undefined,
                runs: [], // Not yet implemented
            },
            memory: {
                enabled: this.config.memory?.enabled ?? false,
                // Deferring detailed stats for now
            },
            indexing: {
                enabled: this.config.indexing?.enabled ?? false,
                autoUpdated: false, // Deferring detailed stats for now
            },
            costs: {
                perProvider: costSummary?.providers || {},
                totals: {
                    inputTokens: costSummary?.total.inputTokens || 0,
                    outputTokens: costSummary?.total.outputTokens || 0,
                    totalTokens: costSummary?.total.totalTokens || 0,
                    estimatedCostUsd: costSummary?.total.estimatedCostUsd ?? null,
                },
            },
            artifacts: {
                manifestPath: artifacts.manifest,
                tracePath: artifacts.trace,
                patchPaths: runResult.patchPaths,
                contextPaths: [], // Not yet implemented
                toolLogPaths: [], // Not yet implemented
            },
            telemetry: {
                enabled: this.config.telemetry?.enabled ?? false,
                mode: this.config.telemetry?.mode ?? 'local',
            },
        };
    }
    async runL0(goal, runId) {
        const startTime = Date.now();
        // 1. Setup Artifacts
        const artifacts = await (0, shared_1.createRunDir)(this.repoRoot, runId);
        loader_1.ConfigLoader.writeEffectiveConfig(this.config, artifacts.root);
        const logger = new shared_1.JsonlLogger(artifacts.trace);
        const emitEvent = async (e) => {
            await logger.log(e);
        };
        await emitEvent({
            type: 'RunStarted',
            schemaVersion: 1,
            timestamp: new Date().toISOString(),
            runId,
            payload: { taskId: runId, goal },
        });
        // Initialize manifest
        await (0, shared_1.writeManifest)(artifacts.manifest, {
            runId,
            startedAt: new Date().toISOString(),
            command: `run ${goal}`,
            repoRoot: this.repoRoot,
            artifactsDir: artifacts.root,
            tracePath: artifacts.trace,
            summaryPath: artifacts.summary,
            effectiveConfigPath: path_1.default.join(artifacts.root, 'effective-config.json'),
            patchPaths: [],
            toolLogPaths: [],
        });
        // 2. Build Minimal Context
        const scanner = new repo_1.RepoScanner();
        const searchService = new repo_1.SearchService();
        // Wire up search events to logger
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        searchService.on('RepoSearchStarted', (_e) => {
            /* log if needed */
        });
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        searchService.on('RepoSearchFinished', (_e) => {
            /* log if needed */
        });
        // Scan repo structure
        const snapshot = await scanner.scan(this.repoRoot);
        const fileList = snapshot.files.map((f) => f.path).join('\n');
        // Search for keywords (simple tokenization of goal)
        const keywords = goal
            .split(' ')
            .filter((w) => w.length > 3)
            .slice(0, 5);
        let searchResults = '';
        if (keywords.length > 0) {
            const terms = keywords.slice(0, 3);
            if (terms.length > 0) {
                const regex = `(${terms.join('|')})`;
                try {
                    const results = await searchService.search({
                        query: regex,
                        cwd: this.repoRoot,
                        maxMatchesPerFile: 3,
                    });
                    searchResults = results.matches
                        .map((m) => `${m.path}:${m.line} ${m.matchText.trim()}`)
                        .join('\n');
                }
                catch {
                    searchResults = '(Search failed)';
                }
            }
        }
        const context = `
REPOSITORY STRUCTURE:
${fileList}

SEARCH RESULTS (for keywords: ${keywords.join(', ')}):
${searchResults || '(No matches)'}
`;
        // 3. Prompt Executor
        const executor = this.registry.getAdapter(this.config.defaults?.executor || 'openai');
        if (!executor) {
            throw new shared_1.ConfigError('No executor provider configured');
        }
        const systemPrompt = `
You are an expert software engineer.
Your task is to implement the following goal: "${goal}"

CONTEXT:
${context}

INSTRUCTIONS:
1. Analyze the context and the goal.
2. Produce a unified diff that implements the changes.
3. Output ONLY the unified diff between BEGIN_DIFF and END_DIFF markers.
4. Do not include any explanations outside the markers.

Example Output:
BEGIN_DIFF
diff --git a/file.ts b/file.ts
--- a/file.ts
+++ b/file.ts
@@ -1,1 +1,1 @@
-old
+new
END_DIFF
`;
        const response = await executor.generate({
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: 'Implement the goal.' },
            ],
        }, { runId, logger });
        const outputText = response.text;
        if (outputText) {
            await promises_1.default.writeFile(path_1.default.join(artifacts.root, 'executor_output.txt'), outputText);
        }
        // 4. Parse Diff
        const diffMatch = outputText?.match(/BEGIN_DIFF([\s\S]*?)END_DIFF/);
        if (!diffMatch || !diffMatch[1].trim()) {
            const msg = 'Failed to extract diff from executor output';
            await emitEvent({
                type: 'RunFinished',
                schemaVersion: 1,
                timestamp: new Date().toISOString(),
                runId,
                payload: { status: 'failure', summary: msg },
            });
            const runResult = {
                status: 'failure',
                runId,
                summary: msg,
                memory: this.config.memory,
                verification: {
                    enabled: false,
                    passed: false,
                    summary: 'Not run',
                },
            };
            const summary = await this._buildRunSummary(runId, goal, startTime, 'failure', { thinkLevel: 'L0' }, runResult, artifacts);
            await shared_1.SummaryWriter.write(summary, artifacts.root);
            // Write manifest before returning
            await (0, shared_1.writeManifest)(artifacts.manifest, {
                runId,
                startedAt: new Date().toISOString(),
                command: `run ${goal}`,
                repoRoot: this.repoRoot,
                artifactsDir: artifacts.root,
                tracePath: artifacts.trace,
                summaryPath: artifacts.summary,
                effectiveConfigPath: path_1.default.join(artifacts.root, 'effective-config.json'),
                patchPaths: [],
                toolLogPaths: [],
            });
            await this.writeEpisodicMemory(summary, {
                artifactsRoot: artifacts.root,
            }, { emit: emitEvent });
            return { status: 'failure', runId, summary: msg };
        }
        const rawDiffContent = diffMatch[1];
        // Remove completely empty leading/trailing lines (no characters at all)
        // but preserve lines with spaces (which are valid diff context for blank lines)
        const lines = rawDiffContent.split('\n');
        const firstContentIdx = lines.findIndex((l) => l !== '');
        let lastContentIdx = -1;
        for (let i = lines.length - 1; i >= 0; i--) {
            if (lines[i] !== '') {
                lastContentIdx = i;
                break;
            }
        }
        const diffContent = firstContentIdx === -1 ? '' : lines.slice(firstContentIdx, lastContentIdx + 1).join('\n');
        // 5. Apply Patch
        const patchStore = new patch_store_1.PatchStore(artifacts.patchesDir, artifacts.manifest);
        const patchPath = await patchStore.saveSelected(0, diffContent);
        await patchStore.saveFinalDiff(diffContent);
        await emitEvent({
            type: 'PatchProposed',
            schemaVersion: 1,
            timestamp: new Date().toISOString(),
            runId,
            payload: {
                diffPreview: diffContent,
                filePaths: [],
            },
        });
        const applier = new repo_1.PatchApplier();
        const patchTextWithNewline = diffContent.endsWith('\n') ? diffContent : diffContent + '\n';
        const result = await applier.applyUnifiedDiff(this.repoRoot, patchTextWithNewline, {
            maxFilesChanged: this.config.patch?.maxFilesChanged,
            maxLinesTouched: this.config.patch?.maxLinesChanged,
            allowBinary: this.config.patch?.allowBinary,
        });
        let runResult;
        if (result.applied) {
            await emitEvent({
                type: 'PatchApplied',
                schemaVersion: 1,
                timestamp: new Date().toISOString(),
                runId,
                payload: {
                    description: 'L0 Auto-applied patch',
                    filesChanged: result.filesChanged,
                    success: true,
                },
            });
            await emitEvent({
                type: 'RunFinished',
                schemaVersion: 1,
                timestamp: new Date().toISOString(),
                runId,
                payload: {
                    status: 'success',
                    summary: 'Patch applied successfully',
                },
            });
            runResult = {
                status: 'success',
                runId,
                summary: 'Patch applied successfully',
                filesChanged: result.filesChanged,
                patchPaths: [patchPath],
                memory: this.config.memory,
                verification: {
                    enabled: false,
                    passed: false,
                    summary: 'Not run',
                },
            };
        }
        else {
            const msg = result.error?.message || 'Unknown error';
            await emitEvent({
                type: 'PatchApplyFailed',
                schemaVersion: 1,
                timestamp: new Date().toISOString(),
                runId,
                payload: {
                    error: msg,
                    details: result.error?.details,
                },
            });
            await emitEvent({
                type: 'RunFinished',
                schemaVersion: 1,
                timestamp: new Date().toISOString(),
                runId,
                payload: { status: 'failure', summary: 'Patch application failed' },
            });
            runResult = {
                status: 'failure',
                runId,
                summary: `Patch application failed: ${msg}`,
                patchPaths: [patchPath],
                memory: this.config.memory,
                verification: {
                    enabled: false,
                    passed: false,
                    summary: 'Not run',
                },
            };
        }
        const summary = await this._buildRunSummary(runId, goal, startTime, runResult.status, { thinkLevel: 'L0' }, runResult, artifacts);
        await shared_1.SummaryWriter.write(summary, artifacts.root);
        // Write manifest
        await (0, shared_1.writeManifest)(artifacts.manifest, {
            runId,
            startedAt: new Date().toISOString(),
            command: `run ${goal}`,
            repoRoot: this.repoRoot,
            artifactsDir: artifacts.root,
            tracePath: artifacts.trace,
            summaryPath: artifacts.summary,
            effectiveConfigPath: path_1.default.join(artifacts.root, 'effective-config.json'),
            patchPaths: [patchPath],
            toolLogPaths: [],
        });
        await this.writeEpisodicMemory(summary, {
            artifactsRoot: artifacts.root,
            patchPaths: runResult.patchPaths,
        }, { emit: emitEvent });
        return runResult;
    }
    async runL1(goal, runId) {
        const startTime = Date.now();
        const artifacts = await (0, shared_1.createRunDir)(this.repoRoot, runId);
        loader_1.ConfigLoader.writeEffectiveConfig(this.config, artifacts.root);
        const logger = new shared_1.JsonlLogger(artifacts.trace);
        const eventBus = {
            emit: async (e) => await logger.log(e),
        };
        await eventBus.emit({
            type: 'RunStarted',
            schemaVersion: 1,
            timestamp: new Date().toISOString(),
            runId,
            payload: { taskId: runId, goal },
        });
        // Initialize manifest
        await (0, shared_1.writeManifest)(artifacts.manifest, {
            runId,
            startedAt: new Date().toISOString(),
            command: `run ${goal}`,
            repoRoot: this.repoRoot,
            artifactsDir: artifacts.root,
            tracePath: artifacts.trace,
            summaryPath: artifacts.summary,
            effectiveConfigPath: path_1.default.join(artifacts.root, 'effective-config.json'),
            patchPaths: [],
            contextPaths: [],
            toolLogPaths: [],
        });
        const plannerId = this.config.defaults?.planner || 'openai';
        const executorId = this.config.defaults?.executor || 'openai';
        const reviewerId = this.config.defaults?.reviewer || 'openai';
        const providers = await this.registry.resolveRoleProviders({ plannerId, executorId, reviewerId }, { eventBus, runId });
        const planService = new service_1.PlanService(eventBus);
        const context = {
            runId,
            config: this.config,
            logger,
        };
        const steps = await planService.generatePlan(goal, { planner: providers.planner }, context, artifacts.root, this.repoRoot, this.config);
        if (steps.length === 0) {
            const msg = 'Planning failed to produce any steps.';
            await eventBus.emit({
                type: 'RunFinished',
                schemaVersion: 1,
                timestamp: new Date().toISOString(),
                runId,
                payload: { status: 'failure', summary: msg },
            });
            const runResult = {
                status: 'failure',
                runId,
                summary: msg,
                memory: this.config.memory,
                verification: {
                    enabled: false,
                    passed: false,
                    summary: 'Not run',
                },
            };
            const summary = await this._buildRunSummary(runId, goal, startTime, 'failure', { thinkLevel: 'L1' }, runResult, artifacts);
            await shared_1.SummaryWriter.write(summary, artifacts.root);
            await this.writeEpisodicMemory(summary, {
                artifactsRoot: artifacts.root,
            }, eventBus);
            return runResult;
        }
        const executionService = new service_2.ExecutionService(eventBus, this.git, new repo_1.PatchApplier(), runId, this.repoRoot, this.config);
        // Budget & Loop State
        const budget = { ...budget_1.DEFAULT_BUDGET, ...this.config.budget };
        let stepsCompleted = 0;
        const patchPaths = [];
        const contextPaths = [];
        const touchedFiles = new Set();
        let consecutiveInvalidDiffs = 0;
        let consecutiveApplyFailures = 0;
        let lastApplyErrorHash = '';
        const finish = async (status, stopReason, summaryMsg) => {
            if (stopReason) {
                await eventBus.emit({
                    type: 'RunStopped',
                    schemaVersion: 1,
                    timestamp: new Date().toISOString(),
                    runId,
                    payload: { reason: stopReason, details: summaryMsg },
                });
            }
            await eventBus.emit({
                type: 'RunFinished',
                schemaVersion: 1,
                timestamp: new Date().toISOString(),
                runId,
                payload: { status, summary: summaryMsg },
            });
            await (0, shared_1.writeManifest)(artifacts.manifest, {
                runId,
                startedAt: new Date().toISOString(),
                command: `run ${goal}`,
                repoRoot: this.repoRoot,
                artifactsDir: artifacts.root,
                tracePath: artifacts.trace,
                summaryPath: artifacts.summary,
                effectiveConfigPath: path_1.default.join(artifacts.root, 'effective-config.json'),
                patchPaths,
                contextPaths,
                toolLogPaths: [],
            });
            const runResult = {
                status,
                runId,
                summary: summaryMsg,
                filesChanged: Array.from(touchedFiles),
                patchPaths,
                stopReason,
                memory: this.config.memory,
                verification: {
                    enabled: false,
                    passed: false,
                    summary: 'Not run',
                },
            };
            const summary = await this._buildRunSummary(runId, goal, startTime, status, { thinkLevel: 'L1' }, runResult, artifacts);
            await shared_1.SummaryWriter.write(summary, artifacts.root);
            await (0, shared_1.writeManifest)(artifacts.manifest, {
                runId,
                startedAt: new Date().toISOString(),
                command: `run ${goal}`,
                repoRoot: this.repoRoot,
                artifactsDir: artifacts.root,
                tracePath: artifacts.trace,
                summaryPath: artifacts.summary,
                effectiveConfigPath: path_1.default.join(artifacts.root, 'effective-config.json'),
                patchPaths,
                contextPaths,
                toolLogPaths: [],
            });
            await this.writeEpisodicMemory(summary, {
                artifactsRoot: artifacts.root,
                patchPaths,
                extraArtifactPaths: contextPaths,
            }, eventBus);
            return runResult;
        };
        for (const step of steps) {
            // 1. Budget Checks
            const elapsed = Date.now() - startTime;
            if (budget.time !== undefined && elapsed > budget.time) {
                return finish('failure', 'budget_exceeded', `Time budget exceeded (${budget.time}ms)`);
            }
            if (budget.iter !== undefined && stepsCompleted >= budget.iter) {
                return finish('failure', 'budget_exceeded', `Iteration budget exceeded (${budget.iter})`);
            }
            if (budget.cost !== undefined && this.costTracker) {
                const summary = this.costTracker.getSummary();
                if (summary.total.estimatedCostUsd && summary.total.estimatedCostUsd > budget.cost) {
                    return finish('failure', 'budget_exceeded', `Cost budget exceeded ($${budget.cost})`);
                }
            }
            await eventBus.emit({
                type: 'StepStarted',
                schemaVersion: 1,
                timestamp: new Date().toISOString(),
                runId,
                payload: { step, index: stepsCompleted, total: steps.length },
            });
            let contextPack;
            try {
                const scanner = new repo_1.RepoScanner();
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                const snapshot = await scanner.scan(this.repoRoot, {
                    excludes: this.config.context?.exclude,
                });
                const searchService = new repo_1.SearchService(this.config.context?.rgPath);
                const searchResults = await searchService.search({
                    query: step,
                    cwd: this.repoRoot,
                    maxMatchesPerFile: 5,
                });
                const lexicalMatches = searchResults.matches;
                // M15-07: Semantic Search
                let semanticHits = [];
                if (this.config.indexing?.semantic?.enabled) {
                    try {
                        const indexPath = path_1.default.join(this.repoRoot, this.config.indexing.path);
                        if (fsSync.existsSync(path_1.default.join(indexPath, 'semantic.sqlite'))) {
                            const store = new repo_1.SemanticIndexStore();
                            store.init(path_1.default.join(indexPath, 'semantic.sqlite'));
                            const embedderId = store.getMeta()?.embedderId;
                            if (embedderId) {
                                const embedder = this.registry.getAdapter(embedderId);
                                const semanticSearchService = new repo_1.SemanticSearchService({
                                    store,
                                    embedder,
                                    eventBus,
                                });
                                const hits = await semanticSearchService.search(step, this.config.indexing.semantic.topK ?? 5, runId);
                                if (hits.length > 0) {
                                    const hitsArtifactPath = path_1.default.join(artifacts.root, `semantic_hits_step_${stepsCompleted}.json`);
                                    await promises_1.default.writeFile(hitsArtifactPath, JSON.stringify(hits, null, 2));
                                    contextPaths.push(hitsArtifactPath);
                                }
                                semanticHits = hits.map((hit) => ({
                                    path: hit.path,
                                    startLine: hit.startLine,
                                    endLine: hit.endLine,
                                    content: hit.content,
                                    score: hit.score,
                                }));
                            }
                            store.close();
                        }
                    }
                    catch (e) {
                        await eventBus.emit({
                            type: 'SemanticSearchFailed',
                            schemaVersion: 1,
                            runId,
                            timestamp: new Date().toISOString(),
                            payload: {
                                error: e.message,
                            },
                        });
                    }
                }
                const allMatches = [
                    ...lexicalMatches,
                    ...semanticHits.map((h) => ({
                        path: h.path,
                        line: h.startLine,
                        column: 0,
                        matchText: 'SEMANTIC_MATCH',
                        lineText: '',
                        score: h.score || 0.5,
                    })),
                ];
                for (const touched of touchedFiles) {
                    allMatches.push({
                        path: touched,
                        line: 1,
                        column: 1,
                        matchText: 'PREVIOUSLY_TOUCHED',
                        lineText: '',
                        score: 1000,
                    });
                }
                const extractor = new repo_1.SnippetExtractor();
                const candidates = await extractor.extractSnippets(allMatches, { cwd: this.repoRoot });
                const packer = new repo_1.SimpleContextPacker();
                contextPack = packer.pack(step, [], candidates, {
                    tokenBudget: this.config.context?.tokenBudget || 8000,
                });
            }
            catch {
                // Ignore context errors
            }
            // Memory Search
            const memoryHits = await this.searchMemoryHits({
                query: `${goal} ${step}`,
                runId,
                stepId: stepsCompleted,
                artifactsRoot: artifacts.root,
                intent: 'implementation',
            }, eventBus);
            const fuser = new context_1.SimpleContextFuser();
            const fusionBudgets = {
                maxRepoContextChars: (this.config.context?.tokenBudget || 8000) * 4,
                maxMemoryChars: this.config.memory?.maxChars ?? 2000,
                maxSignalsChars: 1000,
            };
            // TODO: Plumb real signals
            const signals = [];
            const fusedContext = fuser.fuse({
                goal: `Goal: ${goal}\nCurrent Step: ${step}`,
                repoPack: contextPack || { items: [], totalChars: 0, estimatedTokens: 0 },
                memoryHits,
                signals,
                budgets: fusionBudgets,
            });
            const stepSlug = step.slice(0, 20).replace(/[^a-z0-9]/gi, '_');
            const fusedJsonPath = path_1.default.join(artifacts.root, `fused_context_step_${stepsCompleted}_${stepSlug}.json`);
            const fusedTxtPath = path_1.default.join(artifacts.root, `fused_context_step_${stepsCompleted}_${stepSlug}.txt`);
            await promises_1.default.writeFile(fusedJsonPath, JSON.stringify(fusedContext.metadata, null, 2));
            await promises_1.default.writeFile(fusedTxtPath, fusedContext.prompt);
            contextPaths.push(fusedJsonPath, fusedTxtPath);
            const contextText = fusedContext.prompt;
            let attempt = 0;
            let success = false;
            let lastError = '';
            while (attempt < 2 && !success) {
                attempt++;
                let systemPrompt = `You are an expert software engineer.
Your task is to implement the current step: "${step}"
Part of the overall goal: "${goal}"

CONTEXT:
${contextText}

INSTRUCTIONS:
1. Analyze the context and the step.
2. Produce a unified diff that implements the changes for THIS STEP ONLY.
3. Output ONLY the unified diff between BEGIN_DIFF and END_DIFF markers.
4. Do not include any explanations outside the markers.
`;
                if (attempt > 1) {
                    systemPrompt += `

PREVIOUS ATTEMPT FAILED. Error: ${lastError}\nPlease fix the error and try again.`;
                }
                const response = await providers.executor.generate({
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: 'Implement the step.' },
                    ],
                }, { runId, logger });
                const outputText = response.text;
                if (outputText) {
                    const stepSlug = step.slice(0, 20).replace(/[^a-z0-9]/gi, '_');
                    await promises_1.default.writeFile(path_1.default.join(artifacts.root, `step_${stepsCompleted}_${stepSlug}_attempt_${attempt}_output.txt`), outputText);
                }
                const diffMatch = outputText?.match(/BEGIN_DIFF([\s\S]*?)END_DIFF/);
                if (!diffMatch || !diffMatch[1].trim()) {
                    lastError = 'Failed to extract diff from executor output';
                    consecutiveInvalidDiffs++;
                    if (consecutiveInvalidDiffs >= 2) {
                        return finish('failure', 'invalid_output', 'Executor produced invalid output twice consecutively');
                    }
                    continue;
                }
                else {
                    consecutiveInvalidDiffs = 0;
                }
                const rawDiffContent = diffMatch[1];
                // Remove completely empty leading/trailing lines (no characters at all)
                // but preserve lines with spaces (which are valid diff context for blank lines)
                const lines = rawDiffContent.split('\n');
                const firstContentIdx = lines.findIndex((l) => l !== '');
                let lastContentIdx = -1;
                for (let i = lines.length - 1; i >= 0; i--) {
                    if (lines[i] !== '') {
                        lastContentIdx = i;
                        break;
                    }
                }
                const diffContent = firstContentIdx === -1 ? '' : lines.slice(firstContentIdx, lastContentIdx + 1).join('\n');
                if (diffContent.length === 0) {
                    return finish('failure', 'invalid_output', 'Executor produced empty patch');
                }
                const patchStore = new patch_store_1.PatchStore(artifacts.patchesDir, artifacts.manifest);
                const patchPath = await patchStore.saveSelected(stepsCompleted, diffContent);
                if (attempt === 1)
                    patchPaths.push(patchPath);
                const result = await executionService.applyPatch(diffContent, step);
                if (result.success) {
                    success = true;
                    if (result.filesChanged) {
                        result.filesChanged.forEach((f) => touchedFiles.add(f));
                    }
                    consecutiveApplyFailures = 0;
                    lastApplyErrorHash = '';
                }
                else {
                    lastError = result.error || 'Unknown apply error';
                    const errorHash = (0, crypto_1.createHash)('sha256').update(lastError).digest('hex');
                    if (lastApplyErrorHash === errorHash) {
                        consecutiveApplyFailures++;
                    }
                    else {
                        consecutiveApplyFailures = 1;
                        lastApplyErrorHash = errorHash;
                    }
                    if (consecutiveApplyFailures >= 2) {
                        return finish('failure', 'repeated_failure', `Repeated patch apply failure: ${lastError}`);
                    }
                }
            }
            if (success) {
                stepsCompleted++;
                await eventBus.emit({
                    type: 'StepFinished',
                    schemaVersion: 1,
                    timestamp: new Date().toISOString(),
                    runId,
                    payload: { step, success: true },
                });
            }
            else {
                await eventBus.emit({
                    type: 'StepFinished',
                    schemaVersion: 1,
                    timestamp: new Date().toISOString(),
                    runId,
                    payload: { step, success: false, error: lastError },
                });
                return finish('failure', 'repeated_failure', `Step failed after retries: ${step}. Error: ${lastError}`);
            }
        }
        return finish('success', undefined, `L1 Plan Executed Successfully. ${stepsCompleted} steps.`);
    }
    async searchMemoryHits(args, eventBus) {
        const memConfig = this.config.memory;
        if (!memConfig?.enabled) {
            return [];
        }
        const dbPath = this.resolveMemoryDbPath();
        if (!dbPath) {
            return [];
        }
        const store = (0, memory_1.createMemoryStore)();
        try {
            store.init(dbPath);
            const { query } = args;
            const topK = memConfig.retrieval.topK ?? 5;
            const hits = store.search(this.repoRoot, query, {
                topK,
                intent: args.intent,
                staleDownrank: memConfig.retrieval.staleDownrank ?? true,
                failureSignature: args.failureSignature,
            });
            await eventBus.emit({
                type: 'MemorySearched',
                schemaVersion: 1,
                runId: args.runId,
                timestamp: new Date().toISOString(),
                payload: {
                    query,
                    topK,
                    hitsCount: hits.length,
                    intent: args.intent,
                },
            });
            if (hits.length === 0) {
                return [];
            }
            const artifactPath = path_1.default.join(args.artifactsRoot, `memory_hits_step_${args.stepId}.json`);
            await promises_1.default.writeFile(artifactPath, JSON.stringify(hits, null, 2));
            return hits;
        }
        catch (err) {
            // Log but don't fail
            console.error('Memory search failed:', err);
            return [];
        }
        finally {
            store.close();
        }
    }
    async runL2(goal, runId) {
        const startTime = Date.now();
        // 1. Initial Plan & Execute (L1)
        this.suppressEpisodicMemoryWrite = true;
        let l1Result;
        try {
            l1Result = await this.runL1(goal, runId);
        }
        finally {
            this.suppressEpisodicMemoryWrite = false;
        }
        if (l1Result.stopReason === 'budget_exceeded') {
            const artifacts = await (0, shared_1.createRunDir)(this.repoRoot, runId);
            const logger = new shared_1.JsonlLogger(artifacts.trace);
            const eventBus = {
                emit: async (e) => await logger.log(e),
            };
            const summary = await this._buildRunSummary(runId, goal, startTime, l1Result.status, { thinkLevel: 'L2' }, l1Result, artifacts);
            await this.writeEpisodicMemory(summary, {
                artifactsRoot: artifacts.root,
                patchPaths: l1Result.patchPaths,
            }, eventBus);
            return l1Result;
        }
        // 2. Setup Verification
        if (!this.ui || !this.toolPolicy) {
            const artifacts = await (0, shared_1.createRunDir)(this.repoRoot, runId);
            const logger = new shared_1.JsonlLogger(artifacts.trace);
            const eventBus = {
                emit: async (e) => await logger.log(e),
            };
            const summary = await this._buildRunSummary(runId, goal, startTime, l1Result.status, { thinkLevel: 'L2' }, l1Result, artifacts);
            await this.writeEpisodicMemory(summary, {
                artifactsRoot: artifacts.root,
                patchPaths: l1Result.patchPaths,
            }, eventBus);
            return {
                ...l1Result,
                summary: l1Result.summary + ' (L2 skipped: missing UI/Policy)',
            };
        }
        // Re-use run dir structure
        const artifacts = await (0, shared_1.createRunDir)(this.repoRoot, runId);
        const logger = new shared_1.JsonlLogger(artifacts.trace);
        const eventBus = {
            emit: async (e) => await logger.log(e),
        };
        const proceduralMemory = new ProceduralMemoryImpl(this.resolveMemoryDbPath(), this.repoRoot);
        const verificationRunner = new runner_1.VerificationRunner(proceduralMemory, this.toolPolicy, this.ui, eventBus, this.repoRoot);
        // Construct Profile
        const profile = {
            enabled: this.config.verification?.enabled ?? true,
            mode: this.config.verification?.mode || 'auto',
            steps: [],
            auto: {
                enableLint: this.config.verification?.auto?.enableLint ?? true,
                enableTypecheck: this.config.verification?.auto?.enableTypecheck ?? true,
                enableTests: this.config.verification?.auto?.enableTests ?? true,
                testScope: this.config.verification?.auto?.testScope || 'targeted',
                maxCommandsPerIteration: this.config.verification?.auto?.maxCommandsPerIteration ?? 5,
            },
        };
        // 3. Initial Verification
        let verification = await verificationRunner.run(profile, profile.mode, { touchedFiles: l1Result.filesChanged }, { runId });
        const initialReportPath = path_1.default.join(artifacts.root, 'verification_report_initial.json');
        await promises_1.default.writeFile(initialReportPath, JSON.stringify(verification, null, 2));
        const reportPaths = [initialReportPath];
        if (verification.passed) {
            await eventBus.emit({
                type: 'RunFinished',
                schemaVersion: 1,
                timestamp: new Date().toISOString(),
                runId,
                payload: { status: 'success', summary: 'L2 Verified Success' },
            });
            const runResult = {
                ...l1Result,
                status: 'success',
                summary: 'L2 Verified Success',
                memory: this.config.memory,
                verification: {
                    enabled: profile.enabled,
                    passed: true,
                    summary: verification.summary,
                    reportPaths,
                },
            };
            const summary = await this._buildRunSummary(runId, goal, startTime, 'success', { thinkLevel: 'L2' }, runResult, artifacts);
            await shared_1.SummaryWriter.write(summary, artifacts.root);
            await this.writeEpisodicMemory(summary, {
                artifactsRoot: artifacts.root,
                patchPaths: runResult.patchPaths,
                extraArtifactPaths: reportPaths,
                verificationReport: verification,
            }, eventBus);
            return runResult;
        }
        // 4. Repair Loop
        const maxIterations = 5;
        let iterations = 0;
        let failureSignature = verification.failureSignature;
        let consecutiveSameSignature = 0;
        const patchPaths = l1Result.patchPaths || [];
        const touchedFiles = new Set(l1Result.filesChanged);
        const executorId = this.config.defaults?.executor || 'openai';
        const executor = this.registry.getAdapter(executorId);
        while (iterations < maxIterations) {
            iterations++;
            await eventBus.emit({
                type: 'IterationStarted',
                schemaVersion: 1,
                timestamp: new Date().toISOString(),
                runId,
                payload: { iteration: iterations, goal },
            });
            // Stop Conditions checks (Signature)
            if (failureSignature && verification.failureSignature === failureSignature) {
                consecutiveSameSignature++;
                if (consecutiveSameSignature >= 2) {
                    // Non-improving -> Stop
                    await eventBus.emit({
                        type: 'RunStopped',
                        schemaVersion: 1,
                        timestamp: new Date().toISOString(),
                        runId,
                        payload: {
                            reason: 'non_improving',
                            details: 'Verification failure signature unchanged for 2 iterations',
                        },
                    });
                    const runResult = {
                        ...l1Result,
                        status: 'failure',
                        stopReason: 'non_improving',
                        summary: 'Verification failure signature unchanged for 2 iterations',
                        filesChanged: Array.from(touchedFiles),
                        patchPaths,
                        memory: this.config.memory,
                        verification: {
                            enabled: profile.enabled,
                            passed: false,
                            summary: verification.summary,
                            failedChecks: verification.checks.filter((c) => !c.passed).map((c) => c.name),
                            reportPaths,
                        },
                        lastFailureSignature: verification.failureSignature,
                    };
                    const summary = await this._buildRunSummary(runId, goal, startTime, 'failure', { thinkLevel: 'L2' }, runResult, artifacts);
                    await shared_1.SummaryWriter.write(summary, artifacts.root);
                    await this.writeEpisodicMemory(summary, {
                        artifactsRoot: artifacts.root,
                        patchPaths: runResult.patchPaths,
                        extraArtifactPaths: reportPaths,
                        verificationReport: verification,
                    }, eventBus);
                    return runResult;
                }
            }
            else {
                consecutiveSameSignature = 0;
                failureSignature = verification.failureSignature;
            }
            // Search memory for similar failures
            const memoryHits = await this.searchMemoryHits({
                query: `${goal} ${verification.summary}`,
                runId,
                stepId: 100 + iterations,
                artifactsRoot: artifacts.root,
                intent: 'verification',
                failureSignature: verification.failureSignature,
            }, eventBus);
            // Generate Repair
            const verificationSummary = `Verification Failed.\n${verification.summary}\nFailed Checks: ${verification.checks
                .filter((c) => !c.passed)
                .map((c) => c.name)
                .join(', ')}\n`;
            let errorDetails = '';
            for (const check of verification.checks) {
                if (!check.passed) {
                    if (check.stderrPath) {
                        try {
                            const errContent = await promises_1.default.readFile(check.stderrPath, 'utf8');
                            errorDetails += `\nCommand '${check.command}' failed:\n${errContent.slice(-2000)}\n`;
                        }
                        catch {
                            /* ignore */
                        }
                    }
                }
            }
            const fuser = new context_1.SimpleContextFuser();
            const fusedContext = fuser.fuse({
                goal: `Goal: ${goal}\nTask: Fix verification errors.`,
                repoPack: { items: [], totalChars: 0, estimatedTokens: 0 }, // No repo context for repairs yet
                memoryHits,
                signals: [],
                budgets: {
                    maxRepoContextChars: 0,
                    maxMemoryChars: 4000,
                    maxSignalsChars: 1000,
                },
            });
            const repairPrompt = `
The previous attempt failed verification.
Goal: ${goal}

Verification Results:
${verificationSummary}

Error Details:
${errorDetails}

CONTEXT FROM MEMORY:
${fusedContext.prompt}

Please analyze the errors and produce a unified diff to fix them.
Output ONLY the unified diff between BEGIN_DIFF and END_DIFF markers.
`;
            const response = await executor.generate({
                messages: [
                    { role: 'system', content: 'You are an expert software engineer fixing code.' },
                    { role: 'user', content: repairPrompt },
                ],
            }, { runId, logger });
            const outputText = response.text;
            if (outputText) {
                await promises_1.default.writeFile(path_1.default.join(artifacts.root, `repair_iter_${iterations}_output.txt`), outputText);
            }
            const diffMatch = outputText?.match(/BEGIN_DIFF([\s\S]*?)END_DIFF/);
            if (!diffMatch) {
                // Fail iteration (no diff)
                await eventBus.emit({
                    type: 'RepairAttempted',
                    schemaVersion: 1,
                    timestamp: new Date().toISOString(),
                    runId,
                    payload: { iteration: iterations, patchPath: 'none (no-diff)' },
                });
                continue;
            }
            const rawDiffContent = diffMatch[1];
            // Remove completely empty leading/trailing lines (no characters at all)
            // but preserve lines with spaces (which are valid diff context for blank lines)
            const lines = rawDiffContent.split('\n');
            const firstContentIdx = lines.findIndex((l) => l !== '');
            let lastContentIdx = -1;
            for (let i = lines.length - 1; i >= 0; i--) {
                if (lines[i] !== '') {
                    lastContentIdx = i;
                    break;
                }
            }
            const diffContent = firstContentIdx === -1 ? '' : lines.slice(firstContentIdx, lastContentIdx + 1).join('\n');
            // Apply Patch
            const patchStore = new patch_store_1.PatchStore(artifacts.patchesDir, artifacts.manifest);
            const patchPath = await patchStore.saveSelected(100 + iterations, diffContent);
            patchPaths.push(patchPath);
            await eventBus.emit({
                type: 'RepairAttempted',
                schemaVersion: 1,
                timestamp: new Date().toISOString(),
                runId,
                payload: { iteration: iterations, patchPath },
            });
            const applier = new repo_1.PatchApplier();
            const patchTextWithNewline = diffContent.endsWith('\n') ? diffContent : diffContent + '\n';
            const applyResult = await applier.applyUnifiedDiff(this.repoRoot, patchTextWithNewline, {
                maxFilesChanged: 5,
            });
            if (applyResult.applied) {
                applyResult.filesChanged?.forEach((f) => touchedFiles.add(f));
                await eventBus.emit({
                    type: 'PatchApplied',
                    schemaVersion: 1,
                    timestamp: new Date().toISOString(),
                    runId,
                    payload: {
                        description: `L2 Repair Iteration ${iterations}`,
                        filesChanged: applyResult.filesChanged || [],
                        success: true,
                    },
                });
            }
            else {
                await eventBus.emit({
                    type: 'PatchApplyFailed',
                    schemaVersion: 1,
                    timestamp: new Date().toISOString(),
                    runId,
                    payload: {
                        error: applyResult.error?.message || 'Unknown apply error',
                        details: applyResult.error,
                    },
                });
                // Continue loop to try again? Or verify existing state?
                // If patch failed, verify result is likely same, so signature check will catch it.
            }
            // Verify again
            verification = await verificationRunner.run(profile, profile.mode, { touchedFiles: Array.from(touchedFiles) }, { runId });
            const reportPath = path_1.default.join(artifacts.root, `verification_report_iter_${iterations}.json`);
            await promises_1.default.writeFile(reportPath, JSON.stringify(verification, null, 2));
            reportPaths.push(reportPath);
            await promises_1.default.writeFile(path_1.default.join(artifacts.root, `verification_summary_iter_${iterations}.txt`), verification.summary);
            if (verification.passed) {
                await eventBus.emit({
                    type: 'IterationFinished',
                    schemaVersion: 1,
                    timestamp: new Date().toISOString(),
                    runId,
                    payload: { iteration: iterations, result: 'success' },
                });
                await eventBus.emit({
                    type: 'RunFinished',
                    schemaVersion: 1,
                    timestamp: new Date().toISOString(),
                    runId,
                    payload: {
                        status: 'success',
                        summary: `L2 Verified Success after ${iterations} iterations`,
                    },
                });
                // Save Summary
                const runResult = {
                    status: 'success',
                    runId,
                    summary: `L2 Verified Success after ${iterations} iterations`,
                    filesChanged: Array.from(touchedFiles),
                    patchPaths,
                    memory: this.config.memory,
                    verification: {
                        enabled: profile.enabled,
                        passed: true,
                        summary: verification.summary,
                        reportPaths,
                    },
                };
                const summary = await this._buildRunSummary(runId, goal, startTime, 'success', { thinkLevel: 'L2' }, runResult, artifacts);
                await shared_1.SummaryWriter.write(summary, artifacts.root);
                await this.writeEpisodicMemory(summary, {
                    artifactsRoot: artifacts.root,
                    patchPaths: runResult.patchPaths,
                    extraArtifactPaths: reportPaths,
                    verificationReport: verification,
                }, eventBus);
                return runResult;
            }
            await eventBus.emit({
                type: 'IterationFinished',
                schemaVersion: 1,
                timestamp: new Date().toISOString(),
                runId,
                payload: { iteration: iterations, result: 'failure' },
            });
        }
        // Budget exceeded
        const failureSummary = `L2 failed to converge after ${iterations} iterations`;
        await eventBus.emit({
            type: 'RunFinished',
            schemaVersion: 1,
            timestamp: new Date().toISOString(),
            runId,
            payload: { status: 'failure', summary: failureSummary },
        });
        const runResult = {
            status: 'failure',
            runId,
            summary: failureSummary,
            filesChanged: Array.from(touchedFiles),
            patchPaths,
            stopReason: 'budget_exceeded',
            memory: this.config.memory,
            verification: {
                enabled: profile.enabled,
                passed: false,
                summary: verification.summary,
                failedChecks: verification.checks.filter((c) => !c.passed).map((c) => c.name),
                reportPaths,
            },
            lastFailureSignature: verification.failureSignature,
        };
        const summary = await this._buildRunSummary(runId, goal, startTime, 'failure', { thinkLevel: 'L2' }, runResult, artifacts);
        await shared_1.SummaryWriter.write(summary, artifacts.root);
        await this.writeEpisodicMemory(summary, {
            artifactsRoot: artifacts.root,
            patchPaths: runResult.patchPaths,
            extraArtifactPaths: reportPaths,
            verificationReport: verification,
        }, eventBus);
        return runResult;
    }
}
exports.Orchestrator = Orchestrator;
//# sourceMappingURL=orchestrator.js.map