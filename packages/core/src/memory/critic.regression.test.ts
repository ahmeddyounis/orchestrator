
import { describe, it, expect } from 'vitest';
import { assessMemoryIntegrity } from './critic';
import { MemoryEntry } from '@orchestrator/memory';

describe('Memory Critic Regression', () => {
  it('should block procedural memory with a denylisted command pattern', () => {
    const memory: MemoryEntry = {
      id: 'mem-1',
      type: 'procedural',
      scope: 'test',
      content: 'rm -rf /some/dir',
      evidenceJson: JSON.stringify({ exitCode: 0, classification: 'build' }),
      lastUsed: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    const result = assessMemoryIntegrity(memory);
    expect(result.status).toBe('blocked');
    expect(result.reasons).toContain('Command contains denylisted pattern: /rm -rf/');
  });

  it('should block procedural memory with a non-zero exit code', () => {
    const memory: MemoryEntry = {
        id: 'mem-1',
        type: 'procedural',
        scope: 'test',
        content: 'pnpm test',
        evidenceJson: JSON.stringify({ exitCode: 1, classification: 'test' }),
        lastUsed: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };
  
      const result = assessMemoryIntegrity(memory);
      expect(result.status).toBe('blocked');
      expect(result.reasons).toContain('Procedural memory has non-zero exit code: 1');
  });

  it('should block procedural memory with missing evidence', () => {
    const memory: MemoryEntry = {
        id: 'mem-1',
        type: 'procedural',
        scope: 'test',
        content: 'pnpm build',
        evidenceJson: undefined,
        lastUsed: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };
  
      const result = assessMemoryIntegrity(memory);
      expect(result.status).toBe('blocked');
      expect(result.reasons).toContain('Procedural memory is missing evidence.');
  });

  it('should flag content with suspicious phrases as "suspect"', () => {
    const memory: MemoryEntry = {
      id: 'mem-2',
      type: 'episodic',
      scope: 'test',
      content: 'I had to ignore previous instructions to fix this.',
      evidenceJson: JSON.stringify({ summary: 'run summary' }),
      lastUsed: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    const result = assessMemoryIntegrity(memory);
    expect(result.status).toBe('suspect');
    expect(result.reasons).toContain('Content contains suspicious phrase: "ignore previous instructions"');
  });
});
