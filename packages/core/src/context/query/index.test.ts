import { describe, it, expect, vi } from 'vitest';
import { buildQueries } from './index';
import { logger } from '@orchestrator/shared';

vi.mock('@orchestrator/shared', async () => {
  const actual = await vi.importActual('@orchestrator/shared');
  return {
    ...actual,
    logger: {
      trace: vi.fn(),
    },
  };
});

describe('buildQueries', () => {
  it('should generate no queries if no input is provided', () => {
    const { repoQueries, memoryQueries } = buildQueries({ planStep: '' });
    expect(repoQueries).toEqual([]);
    expect(memoryQueries).toEqual([]);
  });

  it('should generate queries from a simple plan step', () => {
    const { repoQueries, memoryQueries } = buildQueries({
      planStep: 'Implement the user profile page',
    });
    expect(memoryQueries).toContain('implement the user profile page');
    expect(repoQueries).toContain('implement');
    expect(repoQueries).toContain('user');
    expect(repoQueries).toContain('profile');
    expect(repoQueries).toContain('page');
  });

  it('should generate queries from a TypeScript compiler error', () => {
    const failureSummary = `
      src/components/Avatar.ts(12,5): error TS2322: Type 'string' is not assignable to type 'number'.
        const userId: number = '123';
    `;
    const { repoQueries, memoryQueries } = buildQueries({
      planStep: 'Fix user ID type issue',
      failureSummary,
    });

    expect(repoQueries).toContain('src/components/avatar.ts');
    expect(repoQueries).toContain("type 'string' is not assignable to type 'number'.");
    expect(repoQueries).toContain('string');
    expect(repoQueries).toContain('number');
    expect(memoryQueries[0]).toContain("src/components/avatar.ts(12,5): error ts2322: type 'string' is not assignable to type 'number'.");
  });

  it('should generate queries from an ESLint error', () => {
    const failureSummary = `
      /Users/dev/project/src/utils.js
        4:1  error  'unusedVar' is defined but never used  no-unused-vars
    `;
    const { repoQueries, memoryQueries } = buildQueries({
      planStep: 'Remove unused variables',
      failureSummary,
    });

    expect(repoQueries).toContain('/users/dev/project/src/utils.js');
    expect(repoQueries).toContain("'unusedvar' is defined but never used");
    expect(memoryQueries).toContain('remove unused variables');
  });

  it('should generate queries from a test failure (jest-like)', () => {
    const failureSummary = `
      FAIL  src/math.test.ts
      ● Test suite failed to run

        ReferenceError: nonExistent is not defined
          at Object.<anonymous> (src/math.test.ts:3:1)
    `;
    const { repoQueries, memoryQueries } = buildQueries({
      planStep: 'Fix broken math test',
      failureSummary,
    });

    expect(repoQueries).toContain('src/math.test.ts');
    expect(repoQueries).toContain('nonexistent is not defined');
    expect(memoryQueries).toContain('fix broken math test');
  });

  it('should include touched files in queries', () => {
    const { repoQueries, memoryQueries } = buildQueries({
      planStep: 'Refactor login component',
      touchedFiles: ['src/components/Login.tsx', 'src/services/auth.ts'],
    });

    expect(repoQueries).toContain('src/components/login.tsx');
    expect(repoQueries).toContain('src/services/auth.ts');
    expect(memoryQueries).toContain('login.tsx');
    expect(memoryQueries).toContain('auth.ts');
  });

  it('should include package focus in queries', () => {
    const { repoQueries, memoryQueries } = buildQueries({
      planStep: 'Update core dependencies',
      packageFocus: 'packages/core',
    });

    expect(repoQueries).toContain('packages/core');
    expect(memoryQueries).toContain('packages/core');
  });

  it('should deduplicate and normalize queries', () => {
    const { repoQueries } = buildQueries({
      planStep: 'Fix BUG in src/app.ts',
      failureSummary: 'Error in src/app.ts!!',
    });

    const occurrences = repoQueries.filter((q) => q === 'src/app.ts').length;
    expect(occurrences).toBe(1);
    expect(repoQueries).toContain('fix');
    expect(repoQueries).toContain('bug');
  });

  it('should cap the number of queries', () => {
    const longPlanStep = 'a b c d e f g h i j k l m n';
    const { repoQueries, memoryQueries } = buildQueries({
      planStep: longPlanStep,
      failureSummary: 'err1 err2 err3 err4 err5 err6 err7',
      touchedFiles: ['f1', 'f2', 'f3', 'f4', 'f5'],
    });

    expect(repoQueries.length).toBeLessThanOrEqual(6);
    expect(memoryQueries.length).toBeLessThanOrEqual(4);
  });

  it('should emit a QueriesBuilt event', () => {
    const { emit } = buildQueries({
      planStep: 'Submit user data',
    });
    emit();

    expect(logger.trace).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'QueriesBuilt',
        payload: {
          repoQueriesCount: 3,
          memoryQueriesCount: 1,
        },
      }),
      'Built context queries'
    );
  });
});