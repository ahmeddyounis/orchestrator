import { describe, it, expect } from 'vitest';
import {
  shouldPurgeEntry,
  validateRetentionPolicy,
  validateHardeningConfig,
  DEFAULT_RETENTION_POLICIES,
  DEFAULT_PURGE_SCHEDULE,
  createEmptyPurgeResult,
  type RetentionPolicy,
  type MemoryHardeningConfig,
  type SensitivityLevel,
} from './hardening';
import type { MemoryEntry } from './types';

describe('Memory Hardening', () => {
  const createTestEntry = (
    overrides: Partial<MemoryEntry & { sensitivity?: SensitivityLevel }> = {},
  ): MemoryEntry & { sensitivity?: SensitivityLevel } => ({
    id: 'test-id',
    repoId: 'test-repo',
    type: 'procedural',
    title: 'Test Entry',
    content: 'Test content',
    stale: false,
    createdAt: Date.now() - 1000,
    updatedAt: Date.now() - 1000,
    ...overrides,
  });

  describe('shouldPurgeEntry', () => {
    it('should not purge entry within retention period', () => {
      const entry = createTestEntry({
        sensitivity: 'internal',
        updatedAt: Date.now() - 1000, // 1 second ago
      });
      const policy: RetentionPolicy = {
        sensitivityLevel: 'internal',
        maxAgeMs: 30 * 24 * 60 * 60 * 1000, // 30 days
      };

      const result = shouldPurgeEntry(entry, [policy]);
      expect(result.shouldPurge).toBe(false);
    });

    it('should purge entry exceeding retention period', () => {
      const entry = createTestEntry({
        sensitivity: 'restricted',
        updatedAt: Date.now() - 48 * 60 * 60 * 1000, // 48 hours ago
      });
      const policy: RetentionPolicy = {
        sensitivityLevel: 'restricted',
        maxAgeMs: 24 * 60 * 60 * 1000, // 24 hours
      };

      const result = shouldPurgeEntry(entry, [policy]);
      expect(result.shouldPurge).toBe(true);
      expect(result.reason).toContain('exceeded max age');
    });

    it('should apply aggressive stale cleanup for matching policies', () => {
      const entry = createTestEntry({
        sensitivity: 'confidential',
        stale: true,
        updatedAt: Date.now() - 2 * 24 * 60 * 60 * 1000, // 2 days ago
      });
      const policy: RetentionPolicy = {
        sensitivityLevel: 'confidential',
        maxAgeMs: 7 * 24 * 60 * 60 * 1000, // 7 days
        aggressiveStaleCleanup: true,
      };

      const result = shouldPurgeEntry(entry, [policy]);
      expect(result.shouldPurge).toBe(true);
      expect(result.reason).toContain('aggressive threshold');
    });

    it('should not apply aggressive cleanup if entry is not stale', () => {
      const entry = createTestEntry({
        sensitivity: 'confidential',
        stale: false,
        updatedAt: Date.now() - 2 * 24 * 60 * 60 * 1000, // 2 days ago
      });
      const policy: RetentionPolicy = {
        sensitivityLevel: 'confidential',
        maxAgeMs: 7 * 24 * 60 * 60 * 1000, // 7 days
        aggressiveStaleCleanup: true,
      };

      const result = shouldPurgeEntry(entry, [policy]);
      expect(result.shouldPurge).toBe(false);
    });

    it('should use default internal sensitivity when not specified', () => {
      const entry = createTestEntry({ updatedAt: Date.now() - 1000 });
      const policy: RetentionPolicy = {
        sensitivityLevel: 'internal',
        maxAgeMs: 30 * 24 * 60 * 60 * 1000,
      };

      const result = shouldPurgeEntry(entry, [policy]);
      expect(result.shouldPurge).toBe(false);
    });
  });

  describe('validateRetentionPolicy', () => {
    it('should accept valid retention policy', () => {
      const policy: RetentionPolicy = {
        sensitivityLevel: 'internal',
        maxAgeMs: 1000,
      };
      expect(() => validateRetentionPolicy(policy)).not.toThrow();
    });

    it('should reject policy with non-positive maxAgeMs', () => {
      const policy: RetentionPolicy = {
        sensitivityLevel: 'internal',
        maxAgeMs: 0,
      };
      expect(() => validateRetentionPolicy(policy)).toThrow('maxAgeMs must be positive');
    });
  });

  describe('validateHardeningConfig', () => {
    it('should accept valid config', () => {
      const config: MemoryHardeningConfig = {
        encryption: { enabled: true, keyEnv: 'MY_KEY' },
        retentionPolicies: DEFAULT_RETENTION_POLICIES,
        purgeSchedule: DEFAULT_PURGE_SCHEDULE,
        defaultSensitivity: 'internal',
      };
      expect(() => validateHardeningConfig(config)).not.toThrow();
    });

    it('should reject config with encryption enabled but no keyEnv', () => {
      const config: MemoryHardeningConfig = {
        encryption: { enabled: true, keyEnv: '' },
        retentionPolicies: [],
        purgeSchedule: DEFAULT_PURGE_SCHEDULE,
        defaultSensitivity: 'internal',
      };
      expect(() => validateHardeningConfig(config)).toThrow('no key environment variable');
    });
  });

  describe('createEmptyPurgeResult', () => {
    it('should create result with zero counts', () => {
      const result = createEmptyPurgeResult();
      expect(result.purgedCount).toBe(0);
      expect(result.purgedByType.procedural).toBe(0);
      expect(result.errors).toHaveLength(0);
    });
  });
});
