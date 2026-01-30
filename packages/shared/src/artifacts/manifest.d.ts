export declare const MANIFEST_VERSION = 1;
export declare const MANIFEST_FILENAME = "manifest.json";
export interface Manifest {
    schemaVersion: number;
    runId: string;
    runDir: string;
    createdAt: string;
    updatedAt: string;
    paths: {
        trace?: string;
        summary?: string;
        effectiveConfig?: string;
        finalDiff?: string;
        patchesDir?: string;
        toolLogsDir?: string;
    };
    lists: {
        patchPaths: string[];
        toolLogPaths: string[];
        contextPaths: string[];
        provenancePaths: string[];
        verificationPaths: string[];
    };
}
//# sourceMappingURL=manifest.d.ts.map