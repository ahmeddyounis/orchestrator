import { describe, expect, it } from 'vitest';
import { INDEX_SCHEMA_VERSION } from './store';
import { documentToLegacyIndex, legacyIndexToDocument } from './convert';
import type { Index } from './types';

describe('indexing convert', () => {
  it('converts legacy index to document and back', () => {
    const builtAt = new Date('2026-01-01T00:00:00.000Z');
    const updatedAt = new Date('2026-01-01T00:00:01.000Z');

    const legacy: Index = {
      version: '1',
      repoRoot: '/repo',
      builtAt,
      updatedAt,
      stats: {
        fileCount: 1,
        textFileCount: 1,
        hashedCount: 1,
        byLanguage: {
          typescript: { count: 1, bytes: 10 },
        },
      },
      files: [
        {
          path: 'src/a.ts',
          sha256: 'hash',
          sizeBytes: 10,
          mtimeMs: 123,
          isText: true,
          languageHint: 'typescript',
        },
      ],
    };

    const doc = legacyIndexToDocument('repo-id', legacy);
    expect(doc.schemaVersion).toBe(INDEX_SCHEMA_VERSION);
    expect(doc.repoId).toBe('repo-id');
    expect(doc.repoRoot).toBe('/repo');
    expect(doc.builtAt).toBe(builtAt.getTime());
    expect(doc.updatedAt).toBe(updatedAt.getTime());
    expect(doc.files[0]?.path).toBe('src/a.ts');

    const roundTrip = documentToLegacyIndex(doc);
    expect(roundTrip.version).toBe('1');
    expect(roundTrip.repoRoot).toBe('/repo');
    expect(roundTrip.builtAt.toISOString()).toBe(builtAt.toISOString());
    expect(roundTrip.updatedAt.toISOString()).toBe(updatedAt.toISOString());
    expect(roundTrip.files).toEqual(legacy.files);
    expect(roundTrip.stats).toEqual(legacy.stats);
  });
});
