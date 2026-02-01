"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TraceWriter = void 0;
const node_path_1 = __importDefault(require("node:path"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_crypto_1 = require("node:crypto");
const types_1 = require("./types");
const redaction_1 = require("../redaction");
class TraceWriter {
    runId;
    traceStream;
    inFlightSpans = new Map();
    constructor(runId, traceDir) {
        this.runId = runId;
        if (!node_fs_1.default.existsSync(traceDir)) {
            node_fs_1.default.mkdirSync(traceDir, { recursive: true });
        }
        const tracePath = node_path_1.default.join(traceDir, 'trace.jsonl');
        this.traceStream = node_fs_1.default.createWriteStream(tracePath, { flags: 'a' });
    }
    writeEvent(level, eventType, payload) {
        const event = {
            schemaVersion: types_1.TRACE_SCHEMA_VERSION,
            runId: this.runId,
            ts: Date.now(),
            level,
            eventType,
            payload: (0, redaction_1.redactForLogs)(payload),
        };
        return new Promise((resolve, reject) => {
            this.traceStream.write(JSON.stringify(event) + '\n', (err) => {
                if (err) {
                    return reject(err);
                }
                resolve();
            });
        });
    }
    async startSpan(name, attrs = {}, parentSpanId) {
        const spanId = (0, node_crypto_1.randomUUID)();
        const startTime = Date.now();
        this.inFlightSpans.set(spanId, { spanId, name, startTime });
        const payload = {
            spanId,
            name,
            attrs: (0, redaction_1.redactForLogs)(attrs),
        };
        if (parentSpanId) {
            payload.parentSpanId = parentSpanId;
        }
        await this.writeEvent('info', 'span.start', payload);
        return spanId;
    }
    async endSpan(spanId, status = 'ok', attrs = {}) {
        const span = this.inFlightSpans.get(spanId);
        if (!span) {
            // Or should we throw?
            console.warn(`endSpan called for unknown spanId: ${spanId}`);
            return;
        }
        const durationMs = Date.now() - span.startTime;
        this.inFlightSpans.delete(spanId);
        const payload = {
            spanId,
            name: span.name,
            status,
            durationMs,
            attrs: (0, redaction_1.redactForLogs)(attrs),
        };
        await this.writeEvent('info', 'span.end', payload);
    }
    async close() {
        return new Promise((resolve) => {
            this.traceStream.end(() => {
                resolve();
            });
        });
    }
}
exports.TraceWriter = TraceWriter;
//# sourceMappingURL=trace-writer.js.map