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
exports.PatchStore = void 0;
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
const shared_1 = require("@orchestrator/shared");
class PatchStore {
    patchesDir;
    manifestPath;
    constructor(patchesDir, manifestPath) {
        this.patchesDir = patchesDir;
        this.manifestPath = manifestPath;
    }
    async saveCandidate(iteration, candidateIndex, content) {
        const filename = `iter_${iteration}_candidate_${candidateIndex}.patch`;
        return this.savePatch(filename, content);
    }
    async saveSelected(iteration, content) {
        const filename = `iter_${iteration}_selected.patch`;
        return this.savePatch(filename, content);
    }
    async saveFinalDiff(content) {
        return this.savePatch('final.diff.patch', content);
    }
    async savePatch(filename, content) {
        const filePath = path.join(this.patchesDir, filename);
        const contentWithNewline = content.endsWith('\n') ? content : content + '\n';
        await fs.writeFile(filePath, contentWithNewline, 'utf-8');
        await this.updateManifest(filePath);
        return filePath;
    }
    async updateManifest(patchPath) {
        try {
            const content = await fs.readFile(this.manifestPath, 'utf-8');
            const manifest = JSON.parse(content);
            if (!manifest.patchPaths.includes(patchPath)) {
                manifest.patchPaths.push(patchPath);
                await (0, shared_1.writeManifest)(this.manifestPath, manifest);
            }
        }
        catch (err) {
            // If manifest doesn't exist or is invalid, we should probably fail
            // as it violates the integrity of the run artifacts.
            throw new shared_1.PatchOpError(`Failed to update manifest at ${this.manifestPath}: ${err.message}`);
        }
    }
}
exports.PatchStore = PatchStore;
//# sourceMappingURL=patch_store.js.map