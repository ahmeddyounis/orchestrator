import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { join } from '../fs/path.js';
import os from 'node:os';
import { TraceWriter } from './trace-writer';
import { SpanEndEvent, SpanStartEvent, TraceEvent } from './types';

describe('TraceWriter', () => {
  let tempDir: string;
  let traceWriter: TraceWriter;
  const runId = 'test-run-123';

  beforeEach(() => {
        tempDir = fs.mkdtempSync(join(os.tmpdir(), 'test-'));
    traceWriter = new TraceWriter(runId, tempDir);
  });

  afterEach(async () => {
    await traceWriter.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.useRealTimers();
  });

  const readTraceFile = (): TraceEvent[] => {
    const content = fs.readFileSync(join(tempDir, 'trace.jsonl'), 'utf-8');
    return content
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  };

  it('should create a trace file', async () => {
    await traceWriter.writeEvent('info', 'test.event', {});
    expect(fs.existsSync(join(tempDir, 'trace.jsonl'))).toBe(true);
  });

  it('should write a generic event', async () => {
    await traceWriter.writeEvent('info', 'custom.event', { foo: 'bar' });
    const events = readTraceFile();
    expect(events).toHaveLength(1);
    const event = events[0];
    expect(event.schemaVersion).toBe(1);
    expect(event.runId).toBe(runId);
    expect(event.ts).toBeTypeOf('number');
    expect(event.level).toBe('info');
    expect(event.eventType).toBe('custom.event');
    expect(event.payload).toEqual({ foo: 'bar' });
  });

  it('should write span start and end events', async () => {
    vi.useFakeTimers();

    vi.setSystemTime(new Date(2024, 1, 1, 10, 0, 0));
    const spanId = await traceWriter.startSpan('my-span', { attr1: 'value1' });

    vi.advanceTimersByTime(100);
    await traceWriter.endSpan(spanId, 'ok', { attr2: 'value2' });

    const events = readTraceFile();
    expect(events).toHaveLength(2);

    const [startEvent, endEvent] = events;

    // Validate Start Event
    expect(startEvent.eventType).toBe('span.start');
    const startPayload = startEvent.payload as SpanStartEvent;
    expect(startPayload.spanId).toBe(spanId);
    expect(startPayload.name).toBe('my-span');
    expect(startPayload.attrs).toEqual({ attr1: 'value1' });
    expect(startEvent.ts).toBe(new Date(2024, 1, 1, 10, 0, 0).getTime());

    // Validate End Event
    expect(endEvent.eventType).toBe('span.end');
    const endPayload = endEvent.payload as SpanEndEvent;
    expect(endPayload.spanId).toBe(spanId);
    expect(endPayload.name).toBe('my-span');
    expect(endPayload.status).toBe('ok');
    expect(endPayload.durationMs).toBe(100);
    expect(endPayload.attrs).toEqual({ attr2: 'value2' });
    expect(endEvent.ts).toBe(new Date(2024, 1, 1, 10, 0, 0, 100).getTime());
  });

  it('should handle parent-child spans', async () => {
    const parentId = await traceWriter.startSpan('parent');
    const childId = await traceWriter.startSpan('child', {}, parentId);
    await traceWriter.endSpan(childId);
    await traceWriter.endSpan(parentId);

    const events = readTraceFile();
    expect(events).toHaveLength(4);
    const childStartEvent = events[1];
    expect(childStartEvent.eventType).toBe('span.start');
    const childStartPayload = childStartEvent.payload as SpanStartEvent;
    expect(childStartPayload.name).toBe('child');
    expect(childStartPayload.parentSpanId).toBe(parentId);
  });

  it('should warn when ending a non-existent span', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await traceWriter.endSpan('non-existent-span');
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      'endSpan called for unknown spanId: non-existent-span',
    );
    consoleWarnSpy.mockRestore();
  });
});
