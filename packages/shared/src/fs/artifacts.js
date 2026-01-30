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
exports.createRunArtifactsDir = exports.RUNS_DIR = exports.ORCHESTRATOR_DIR = void 0;
exports.createRunDir = createRunDir;
exports.getRunArtifactPaths = getRunArtifactPaths;
exports.writeManifest = writeManifest;
const path = __importStar(require("path"));
const fs = __importStar(require("fs/promises"));
exports.ORCHESTRATOR_DIR = '.orchestrator';
exports.RUNS_DIR = 'runs';
/**
 * Creates the artifact directory structure for a specific run.
 * Returns the paths to the standard artifacts.
 */
async function createRunDir(baseDir, runId) {
    const runRootDir = path.join(baseDir, exports.ORCHESTRATOR_DIR, exports.RUNS_DIR, runId);
    const toolLogsDir = path.join(runRootDir, 'tool_logs');
    const patchesDir = path.join(runRootDir, 'patches');
    await fs.mkdir(runRootDir, { recursive: true });
    await fs.mkdir(toolLogsDir, { recursive: true });
    await fs.mkdir(patchesDir, { recursive: true });
    return {
        root: runRootDir,
        trace: path.join(runRootDir, 'trace.jsonl'),
        summary: path.join(runRootDir, 'summary.json'),
        manifest: path.join(runRootDir, 'manifest.json'),
        patchesDir: patchesDir,
        toolLogsDir: toolLogsDir,
    };
}
// Alias for backward compatibility if needed, or just remove if I fix call sites.
exports.createRunArtifactsDir = createRunDir;
function getRunArtifactPaths(baseDir, runId) {
    const runRootDir = path.join(baseDir, exports.ORCHESTRATOR_DIR, exports.RUNS_DIR, runId);
    return {
        root: runRootDir,
        trace: path.join(runRootDir, 'trace.jsonl'),
        summary: path.join(runRootDir, 'summary.json'),
        manifest: path.join(runRootDir, 'manifest.json'),
        patchesDir: path.join(runRootDir, 'patches'),
        toolLogsDir: path.join(runRootDir, 'tool_logs'),
    };
}
async function writeManifest(manifestPath, manifest) {
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
}
//# sourceMappingURL=artifacts.js.map