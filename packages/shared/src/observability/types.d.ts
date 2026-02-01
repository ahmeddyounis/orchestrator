export declare const TRACE_SCHEMA_VERSION = 1;
export type TraceEventLevel = 'debug' | 'info' | 'warn' | 'error';
export type TraceEvent = {
  schemaVersion: typeof TRACE_SCHEMA_VERSION;
  runId: string;
  ts: number;
  level: TraceEventLevel;
  eventType: string;
  payload: object;
};
export type SpanStartEvent = {
  spanId: string;
  parentSpanId?: string;
  name: string;
  attrs: Record<string, unknown>;
};
export type SpanEndEvent = {
  spanId: string;
  name: string;
  status: 'ok' | 'error';
  durationMs: number;
  attrs: Record<string, unknown>;
};
//# sourceMappingURL=types.d.ts.map
