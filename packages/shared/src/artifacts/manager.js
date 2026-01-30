"use strict";
// packages/shared/src/artifacts/manager.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.ManifestManager = void 0;
const manifest_js_1 = require("./manifest.js");
const path_1 = require("path");
const index_js_1 = require("../fs/index.js");
const fs_extra_1 = require("fs-extra");
class ManifestManager {
    manifest;
    runDir;
    constructor(runDir, manifest) {
        this.runDir = runDir;
        this.manifest = manifest;
    }
    static async load(runDir) {
        const manifestPath = (0, path_1.join)(runDir, manifest_js_1.MANIFEST_FILENAME);
        let manifest;
        try {
            manifest = (await (0, fs_extra_1.readJson)(manifestPath));
            if (manifest.schemaVersion !== manifest_js_1.MANIFEST_VERSION) {
                // For now, we'll just overwrite. In the future, we might want to migrate.
                manifest = ManifestManager.init(runDir);
            }
        }
        catch (e) {
            manifest = ManifestManager.init(runDir);
        }
        return new ManifestManager(runDir, manifest);
    }
    static init(runDir) {
        const now = new Date().toISOString();
        const runId = (0, path_1.relative)((0, path_1.join)(runDir, '..'), runDir);
        const manifest = {
            schemaVersion: manifest_js_1.MANIFEST_VERSION,
            runId,
            runDir,
            createdAt: now,
            updatedAt: now,
            paths: {
                patchesDir: 'patches',
                toolLogsDir: 'tool-logs',
            },
            lists: {
                patchPaths: [],
                toolLogPaths: [],
                contextPaths: [],
                provenancePaths: [],
                verificationPaths: [],
            },
        };
        return manifest;
    }
    addPatch(path) {
        this.manifest.lists.patchPaths.push(this.relative(path));
    }
    addToolLog(path) {
        this.manifest.lists.toolLogPaths.push(this.relative(path));
    }
    addContext(path) {
        this.manifest.lists.contextPaths.push(this.relative(path));
    }
    addProvenance(path) {
        this.manifest.lists.provenancePaths.push(this.relative(path));
    }
    addVerification(path) {
        this.manifest.lists.verificationPaths.push(this.relative(path));
    }
    setPath(key, path) {
        this.manifest.paths[key] = this.relative(path);
    }
    relative(path) {
        if (!path)
            return '';
        return (0, path_1.relative)(this.runDir, path);
    }
    async save() {
        this.manifest.updatedAt = new Date().toISOString();
        const manifestPath = (0, path_1.join)(this.runDir, manifest_js_1.MANIFEST_FILENAME);
        await (0, index_js_1.ensureDir)(this.runDir);
        await (0, index_js_1.atomicWrite)(manifestPath, JSON.stringify(this.manifest, null, 2));
    }
    getManifest() {
        return this.manifest;
    }
}
exports.ManifestManager = ManifestManager;
//# sourceMappingURL=manager.js.map