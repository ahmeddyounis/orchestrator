import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import path from 'path';
import { ContextStackStore } from './store';
import { renderContextStackForPrompt } from './render';
import { CONTEXT_STACK_FRAME_SCHEMA_VERSION } from './types';

describe('ContextStackStore', () => {
  let tmpDir: string | undefined;

  afterEach(async () => {
    if (!tmpDir) return;
    await fs.rm(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  });

  it('appends and loads frames', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-stack-'));
    const filePath = path.join(tmpDir, 'context_stack.jsonl');

    const store = new ContextStackStore({ filePath, maxFrames: 10, maxBytes: 50_000 });
    await store.load();
    expect(store.getAllFrames()).toEqual([]);

    await store.append({
      schemaVersion: CONTEXT_STACK_FRAME_SCHEMA_VERSION,
      ts: '2026-02-06T00:00:00.000Z',
      runId: 'run-1',
      kind: 'Test',
      title: 'Frame 1',
      summary: 'Hello',
    });

    const store2 = new ContextStackStore({ filePath, maxFrames: 10, maxBytes: 50_000 });
    await store2.load();
    expect(store2.getAllFrames()).toHaveLength(1);
    expect(store2.getAllFrames()[0]).toEqual(
      expect.objectContaining({
        kind: 'Test',
        title: 'Frame 1',
        summary: 'Hello',
      }),
    );
  });

  it('compacts the file when it exceeds maxBytes', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-stack-'));
    const filePath = path.join(tmpDir, 'context_stack.jsonl');

    const store = new ContextStackStore({ filePath, maxFrames: 2, maxBytes: 10_000 });
    await store.load();

    await store.append({
      schemaVersion: CONTEXT_STACK_FRAME_SCHEMA_VERSION,
      ts: 't1',
      kind: 'One',
      title: 'one',
      summary: 'a',
    });
    await store.append({
      schemaVersion: CONTEXT_STACK_FRAME_SCHEMA_VERSION,
      ts: 't2',
      kind: 'Two',
      title: 'two',
      summary: 'b',
    });
    await store.append({
      schemaVersion: CONTEXT_STACK_FRAME_SCHEMA_VERSION,
      ts: 't3',
      kind: 'Three',
      title: 'three',
      summary: 'c',
      details: 'd'.repeat(20_000),
    });

    const raw = await fs.readFile(filePath, 'utf8');
    const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
    expect(lines).toHaveLength(2);
    expect(lines.join('\n')).not.toContain('"kind":"One"');
    expect(lines.join('\n')).toContain('"kind":"Two"');
    expect(lines.join('\n')).toContain('"kind":"Three"');
  });
});

describe('renderContextStackForPrompt', () => {
  it('renders newest frames first', () => {
    const text = renderContextStackForPrompt(
      [
        {
          schemaVersion: CONTEXT_STACK_FRAME_SCHEMA_VERSION,
          ts: 't1',
          runId: 'r',
          kind: 'Old',
          title: 'old',
          summary: 'old summary',
        },
        {
          schemaVersion: CONTEXT_STACK_FRAME_SCHEMA_VERSION,
          ts: 't2',
          runId: 'r',
          kind: 'New',
          title: 'new',
          summary: 'new summary',
        },
      ],
      { maxChars: 10_000, maxFrames: 10 },
    );

    const firstIdx = text.indexOf('t2');
    const secondIdx = text.indexOf('t1');
    expect(firstIdx).toBeGreaterThanOrEqual(0);
    expect(secondIdx).toBeGreaterThanOrEqual(0);
    expect(firstIdx).toBeLessThan(secondIdx);
  });
});
