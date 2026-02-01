"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SummaryWriter = exports.RUN_SUMMARY_SCHEMA_VERSION = void 0;
const node_path_1 = __importDefault(require("node:path"));
const io_js_1 = require("../fs/io.js");
const redaction_1 = require("../redaction");
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
        const redactedSummary = (0, redaction_1.redactForLogs)(summary);
        const summaryJson = JSON.stringify(redactedSummary, null, 2);
        await (0, io_js_1.atomicWrite)(summaryPath, summaryJson);
        return summaryPath;
    }
}
exports.SummaryWriter = SummaryWriter;
//# sourceMappingURL=summary.js.map