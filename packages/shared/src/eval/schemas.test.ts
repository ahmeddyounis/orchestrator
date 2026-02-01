// packages/shared/src/eval/schemas.test.ts

import { describe, it, expect } from 'vitest';
import { validateEvalSuite, validateEvalResult } from './schemas';
import { EVAL_SCHEMA_VERSION } from './types';

describe('Eval Schemas', () => {
  describe('validateEvalSuite', () => {
    const validSuite = {
      schemaVersion: EVAL_SCHEMA_VERSION,
      name: 'Test Suite',
      tasks: [
        {
          id: 'test-task-1',
          title: 'Test Task 1',
          repo: {
            fixturePath: 'path/to/fixture',
          },
          goal: 'Test goal',
          command: 'run' as const,
          verification: {
            enabled: true,
            mode: 'auto' as const,
          },
          tools: {
            enabled: true,
            requireConfirmation: false,
          },
          successCriteria: [
            {
              name: 'verification_pass' as const,
              details: {},
            },
          ],
        },
      ],
    };

    it('should validate a valid suite', () => {
      expect(() => validateEvalSuite(validSuite)).not.toThrow();
    });

    it('should throw an error for an invalid suite', () => {
      const invalidSuite = { ...validSuite, name: 123 };
      expect(() => validateEvalSuite(invalidSuite)).toThrow();
    });
  });

  describe('validateEvalResult', () => {
    const validResult = {
      schemaVersion: EVAL_SCHEMA_VERSION,
      suiteName: 'Test Suite',
      startedAt: 0,
      finishedAt: 1,
      tasks: [
        {
          taskId: 'test-task-1',
          status: 'pass' as const,
          durationMs: 100,
        },
      ],
      aggregates: {
        totalTasks: 1,
        passed: 1,
        failed: 0,
        skipped: 0,
        error: 0,
        totalDurationMs: 100,
        avgDurationMs: 100,
        passRate: 1,
      },
    };

    it('should validate a valid result', () => {
      expect(() => validateEvalResult(validResult)).not.toThrow();
    });

    it('should throw an error for an invalid result', () => {
      const invalidResult = { ...validResult, suiteName: 123 };
      expect(() => validateEvalResult(invalidResult)).toThrow();
    });
  });
});
