import * as fs from 'fs/promises';
import * as path from 'path';
import { describe, it, expect } from 'vitest';
import { parseUnifiedDiffFromText } from './parsers';

const transcriptsDir = path.join(__dirname, 'fixtures', 'transcripts');

describe('parseUnifiedDiffFromText golden transcripts', () => {
  it('should parse diffs from golden transcripts correctly', async () => {
    const files = await fs.readdir(transcriptsDir);
    expect(files.length).toBeGreaterThanOrEqual(10);

    for (const file of files) {
      const transcriptPath = path.join(transcriptsDir, file);
      const transcript = await fs.readFile(transcriptPath, 'utf-8');
      const parsed = parseUnifiedDiffFromText(transcript);
      // We wrap the parsed output in an object with the filename
      // so the snapshot is easier to read.
      const snapshotable = {
        file,
        diff: parsed ? parsed.diffText : null,
        confidence: parsed ? parsed.confidence : null,
      };
      await expect(snapshotable).toMatchSnapshot();
    }
  });
});
