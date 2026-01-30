import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import {
  TraceEvent,
  TraceEventLevel,
  TRACE_SCHEMA_VERSION,
  SpanStartEvent,
  SpanEndEvent,
} from './types';

type InFlightSpan = {
  spanId: string;
  name: string;
  startTime: number;
};

export class TraceWriter {
  private traceStream: fs.WriteStream;
  private inFlightSpans: Map<string, InFlightSpan> = new Map();

  constructor(
    private runId: string,
    traceDir: string,
  ) {
    if (!fs.existsSync(traceDir)) {
      fs.mkdirSync(traceDir, { recursive: true });
    }
    const tracePath = path.join(traceDir, 'trace.jsonl');
    this.traceStream = fs.createWriteStream(tracePath, { flags: 'a' });
  }

  writeEvent(level: TraceEventLevel, eventType: string, payload: object): Promise<void> {
    const event: TraceEvent = {
      schemaVersion: TRACE_SCHEMA_VERSION,
      runId: this.runId,
      ts: Date.now(),
      level,
      eventType,
      payload,
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

  async startSpan(
    name: string,
    attrs: Record<string, unknown> = {},
    parentSpanId?: string,
  ): Promise<string> {
    const spanId = randomUUID();
    const startTime = Date.now();
    this.inFlightSpans.set(spanId, { spanId, name, startTime });

    const payload: SpanStartEvent = {
      spanId,
      name,
      attrs,
    };
    if (parentSpanId) {
      payload.parentSpanId = parentSpanId;
    }

    await this.writeEvent('info', 'span.start', payload);
    return spanId;
  }

  async endSpan(
    spanId: string,
    status: 'ok' | 'error' = 'ok',
    attrs: Record<string, unknown> = {},
  ): Promise<void> {
    const span = this.inFlightSpans.get(spanId);
    if (!span) {
      // Or should we throw?
      console.warn(`endSpan called for unknown spanId: ${spanId}`);
      return;
    }

    const durationMs = Date.now() - span.startTime;
    this.inFlightSpans.delete(spanId);

    const payload: SpanEndEvent = {
      spanId,
      name: span.name,
      status,
      durationMs,
      attrs,
    };

    await this.writeEvent('info', 'span.end', payload);
  }

  async close(): Promise<void> {
    return new Promise((resolve) => {
      this.traceStream.end(() => {
        resolve();
      });
    });
  }
}
