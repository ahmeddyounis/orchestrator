export declare const ORCHESTRATOR_DIR = ".orchestrator";
export declare const RUNS_DIR = "runs";
export interface RunArtifactPaths {
    root: string;
    trace: string;
    summary: string;
    manifest: string;
    patchesDir: string;
    toolLogsDir: string;
}
export interface Manifest {
    runId: string;
    startedAt: string;
    finishedAt?: string;
    command: string;
    repoRoot: string;
    artifactsDir: string;
    tracePath: string;
    summaryPath: string;
    effectiveConfigPath: string;
    patchPaths: string[];
    contextPaths?: string[];
    toolLogPaths: string[];
}
/**
 * Creates the artifact directory structure for a specific run.
 * Returns the paths to the standard artifacts.
 */
export declare function createRunDir(baseDir: string, runId: string): Promise<RunArtifactPaths>;
export declare const createRunArtifactsDir: typeof createRunDir;
export declare function getRunArtifactPaths(baseDir: string, runId: string): RunArtifactPaths;
export declare function writeManifest(manifestPath: string, manifest: Manifest): Promise<void>;
//# sourceMappingURL=artifacts.d.ts.map