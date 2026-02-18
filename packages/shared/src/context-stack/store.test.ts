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

  it('resolves absolute and relative configured paths', () => {
    expect(
      ContextStackStore.resolvePath('/repo', {
        contextStack: { path: '/abs/context_stack.jsonl' },
      } as any),
    ).toBe('/abs/context_stack.jsonl');

    expect(
      ContextStackStore.resolvePath('/repo', {
        contextStack: { path: 'custom/context_stack.jsonl' },
      } as any),
    ).toBe(path.join('/repo', 'custom/context_stack.jsonl'));

    expect(ContextStackStore.resolvePath('/repo')).toBe(
      path.join('/repo', '.orchestrator', 'context_stack.jsonl'),
    );
  });

  it('loads only valid frames and ignores malformed lines', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-stack-'));
    const filePath = path.join(tmpDir, 'context_stack.jsonl');

    const valid1 = {
      schemaVersion: CONTEXT_STACK_FRAME_SCHEMA_VERSION,
      ts: 't1',
      kind: 'One',
      title: 'one',
      summary: 'a',
    };
    const invalidSchema = {
      schemaVersion: CONTEXT_STACK_FRAME_SCHEMA_VERSION,
      ts: 't2',
      kind: 'Two',
      // missing title/summary
    };
    const valid2 = {
      schemaVersion: CONTEXT_STACK_FRAME_SCHEMA_VERSION,
      ts: 't3',
      kind: 'Three',
      title: 'three',
      summary: 'c',
    };

    await fs.writeFile(
      filePath,
      [JSON.stringify(valid1), 'not-json', JSON.stringify(invalidSchema), JSON.stringify(valid2)].join(
        '\n',
      ),
      'utf8',
    );

    const store = new ContextStackStore({ filePath, maxFrames: 10, maxBytes: 50_000 });
    const frames = await store.load();
    expect(frames).toHaveLength(2);
    expect(frames[0]).toEqual(expect.objectContaining({ kind: 'One' }));
    expect(frames[1]).toEqual(expect.objectContaining({ kind: 'Three' }));
  });

  it('snapshots frames to a JSONL file', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-stack-'));
    const filePath = path.join(tmpDir, 'context_stack.jsonl');
    const snapshotPath = path.join(tmpDir, 'snap.jsonl');

    const store = new ContextStackStore({ filePath, maxFrames: 10, maxBytes: 50_000 });
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

    await store.snapshotTo(snapshotPath);

    const raw = await fs.readFile(snapshotPath, 'utf8');
    const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
    expect(lines).toHaveLength(2);
    expect(raw.endsWith('\n')).toBe(true);
  });

  it('sanitizes and redacts frame fields when configured', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-stack-'));
    const filePath = path.join(tmpDir, 'context_stack.jsonl');

    const store = new ContextStackStore({
      filePath,
      security: { redaction: { enabled: true } } as any,
      maxFieldChars: { title: 50, summary: 200, details: 500 },
      maxFrames: 10,
      maxBytes: 50_000,
    });
    await store.load();

    const openAiKey = 'sk-proj-abcdefghijklmnopqrstuvwxyz123456';

    await store.append({
      schemaVersion: CONTEXT_STACK_FRAME_SCHEMA_VERSION,
      ts: 't1',
      kind: 'One',
      title: `${openAiKey} ${'x'.repeat(80)}`,
      summary: `safe ${'y'.repeat(220)}`,
      details: `details ${'z'.repeat(600)}`,
      artifacts: [`artifact ${'a'.repeat(220)}`],
    });

    const [frame] = store.getAllFrames();
    expect(frame.title).toContain('[REDACTED:openai-api-key]');
    expect(frame.title).toContain('...[TRUNCATED]');
    expect(frame.summary).toContain('...[TRUNCATED]');
    expect(frame.details).toContain('...[TRUNCATED]');
    expect(frame.artifacts?.[0]).toContain('...[TRUNCATED]');
  });
});

describe('renderContextStackForPrompt', () => {
  it('returns empty for empty input or zero budgets', () => {
    expect(renderContextStackForPrompt([], { maxChars: 100, maxFrames: 10 })).toBe('');
    expect(
      renderContextStackForPrompt(
        [
          {
            schemaVersion: CONTEXT_STACK_FRAME_SCHEMA_VERSION,
            ts: 't1',
            kind: 'One',
            title: 'one',
            summary: 'a',
          },
        ],
        { maxChars: 0, maxFrames: 10 },
      ),
    ).toBe('');
    expect(
      renderContextStackForPrompt(
        [
          {
            schemaVersion: CONTEXT_STACK_FRAME_SCHEMA_VERSION,
            ts: 't1',
            kind: 'One',
            title: 'one',
            summary: 'a',
          },
        ],
        { maxChars: 100, maxFrames: 0 },
      ),
    ).toBe('');
  });

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

  it('renders optional details/artifacts and includes separators', () => {
    const text = renderContextStackForPrompt(
      [
        {
          schemaVersion: CONTEXT_STACK_FRAME_SCHEMA_VERSION,
          ts: 't1',
          runId: 'r',
          kind: 'Old',
          title: 'old',
          summary: 'old summary',
          details: 'old details',
          artifacts: ['a.txt'],
        },
        {
          schemaVersion: CONTEXT_STACK_FRAME_SCHEMA_VERSION,
          ts: 't2',
          runId: 'r',
          kind: 'New',
          title: 'new',
          summary: 'new summary',
          artifacts: [],
        },
      ],
      { maxChars: 10_000, maxFrames: 10 },
    );

    expect(text).toContain('Details: old details');
    expect(text).toContain('Artifacts: a.txt');
    expect(text).toContain('--------------------');
  });

  it('truncates the latest block when out of character budget', () => {
    const text = renderContextStackForPrompt(
      [
        {
          schemaVersion: CONTEXT_STACK_FRAME_SCHEMA_VERSION,
          ts: 't1',
          kind: 'One',
          title: 'one',
          summary: 'a'.repeat(200),
        },
      ],
      { maxChars: 40, maxFrames: 10 },
    );

    expect(text).toContain('...[TRUNCATED]');
  });

  it('adds an omitted-frames marker with correct pluralization', () => {
    const plural = renderContextStackForPrompt(
      [
        {
          schemaVersion: CONTEXT_STACK_FRAME_SCHEMA_VERSION,
          ts: 't1',
          kind: 'One',
          title: 'one',
          summary: 'a',
        },
        {
          schemaVersion: CONTEXT_STACK_FRAME_SCHEMA_VERSION,
          ts: 't2',
          kind: 'Two',
          title: 'two',
          summary: 'b',
        },
        {
          schemaVersion: CONTEXT_STACK_FRAME_SCHEMA_VERSION,
          ts: 't3',
          kind: 'Three',
          title: 'three',
          summary: 'c',
        },
      ],
      { maxChars: 10_000, maxFrames: 1 },
    );
    expect(plural).toContain('(+2 older frames not shown)');

    const singular = renderContextStackForPrompt(
      [
        {
          schemaVersion: CONTEXT_STACK_FRAME_SCHEMA_VERSION,
          ts: 't1',
          kind: 'One',
          title: 'one',
          summary: 'a',
        },
        {
          schemaVersion: CONTEXT_STACK_FRAME_SCHEMA_VERSION,
          ts: 't2',
          kind: 'Two',
          title: 'two',
          summary: 'b',
        },
      ],
      { maxChars: 10_000, maxFrames: 1 },
    );
    expect(singular).toContain('(+1 older frame not shown)');
  });

  it('falls back to a short truncation marker if there is no room', () => {
    const text = renderContextStackForPrompt(
      [
        {
          schemaVersion: CONTEXT_STACK_FRAME_SCHEMA_VERSION,
          ts: 't1',
          kind: 'One',
          title: 'one',
          summary: 'a',
        },
        {
          schemaVersion: CONTEXT_STACK_FRAME_SCHEMA_VERSION,
          ts: 't2',
          kind: 'Two',
          title: 'two',
          summary: 'b',
        },
      ],
      { maxChars: 35, maxFrames: 1 },
    );

    expect(text.trimEnd().endsWith('...[TRUNCATED]')).toBe(true);
    expect(text).not.toContain('older frame');
  });
});
