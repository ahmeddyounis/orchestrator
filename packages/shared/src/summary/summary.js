"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SummaryWriter = exports.RUN_SUMMARY_SCHEMA_VERSION = void 0;
const promises_1 = require("fs/promises");
const node_path_1 = __importDefault(require("node:path"));
/**
 * Schema version for the run summary.
 *
 * @format
 */
exports.RUN_SUMMARY_SCHEMA_VERSION = 1;
class SummaryWriter {
    static async write(summary, runDir) {
        const summaryPath = node_path_1.default.join(runDir, 'summary.json');
        // The summary object can be large, so we stringify it with indentation
        // to make it human-readable.
        const summaryJson = JSON.stringify(summary, null, 2);
        await (0, promises_1.writeFile)(summaryPath, summaryJson);
        return summaryPath;
    }
}
exports.SummaryWriter = SummaryWriter;
//# sourceMappingURL=summary.js.map