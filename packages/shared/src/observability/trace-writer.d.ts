import { TraceEventLevel } from './types';
export declare class TraceWriter {
    private runId;
    private traceStream;
    private inFlightSpans;
    constructor(runId: string, traceDir: string);
    writeEvent(level: TraceEventLevel, eventType: string, payload: object): Promise<void>;
    startSpan(name: string, attrs?: Record<string, unknown>, parentSpanId?: string): Promise<string>;
    endSpan(spanId: string, status?: 'ok' | 'error', attrs?: Record<string, unknown>): Promise<void>;
    close(): Promise<void>;
}
//# sourceMappingURL=trace-writer.d.ts.map