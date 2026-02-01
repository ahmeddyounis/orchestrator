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
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
const vitest_1 = require("vitest");
const parsers_1 = require("./parsers");
const transcriptsDir = path.join(__dirname, 'fixtures', 'transcripts');
(0, vitest_1.describe)('parseUnifiedDiffFromText golden transcripts', () => {
    (0, vitest_1.it)('should parse diffs from golden transcripts correctly', async () => {
        const files = await fs.readdir(transcriptsDir);
        (0, vitest_1.expect)(files.length).toBeGreaterThanOrEqual(10);
        for (const file of files) {
            const transcriptPath = path.join(transcriptsDir, file);
            const transcript = await fs.readFile(transcriptPath, 'utf-8');
            const parsed = (0, parsers_1.parseUnifiedDiffFromText)(transcript);
            // We wrap the parsed output in an object with the filename
            // so the snapshot is easier to read.
            const snapshotable = {
                file,
                diff: parsed ? parsed.diffText : null,
                confidence: parsed ? parsed.confidence : null,
            };
            await (0, vitest_1.expect)(snapshotable).toMatchSnapshot();
        }
    });
});
