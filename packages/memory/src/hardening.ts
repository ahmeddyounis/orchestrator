/**
 * Memory System Hardening Module
 *
 * Implements encryption toggle, retention policies, and automatic purge schedules
 * for sensitive context stored in the memory system.
 */

import { MemoryError } from '@orchestrator/shared';
import type { MemoryEntry, MemoryEntryType } from './types';

/**
 * Sensitivity level for memory entries.
 * Higher levels indicate more sensitive data requiring stricter handling.
 */
export type SensitivityLevel = 'public' | 'internal' | 'confidential' | 'restricted';

/**
 * Retention policy configuration for memory entries.
 */
export interface RetentionPolicy {
  /** Maximum age in milliseconds before automatic purge */
  maxAgeMs: number;
  /** Sensitivity level this policy applies to */
  sensitivityLevel: SensitivityLevel;
  /** Memory types this policy applies to (empty = all types) */
  entryTypes?: MemoryEntryType[];
  /** Whether to purge stale entries more aggressively */
  aggressiveStaleCleanup?: boolean;
}

/**
 * Purge schedule configuration.
 */
export interface PurgeSchedule {
  /** Cron-like interval in milliseconds for purge checks */
  intervalMs: number;
  /** Whether the schedule is currently active */
  enabled: boolean;
  /** Last purge timestamp */
  lastPurgeAt?: number;
}

/**
 * Result of a purge operation.
 */
export interface PurgeResult {
  /** Number of entries purged */
  purgedCount: number;
  /** Entries purged by type */
  purgedByType: Record<MemoryEntryType, number>;
  /** Entries purged by sensitivity */
  purgedBySensitivity: Record<SensitivityLevel, number>;
  /** Timestamp of the purge */
  purgedAt: number;
  /** Errors encountered during purge (non-fatal) */
  errors: string[];
}

/**
 * Memory hardening configuration.
 */
export interface MemoryHardeningConfig {
  /** Encryption settings */
  encryption: {
    /** Whether encryption at rest is enabled */
    enabled: boolean;
    /** Environment variable containing the encryption key */
    keyEnv: string;
  };
  /** Retention policies (applied in order, first match wins) */
  retentionPolicies: RetentionPolicy[];
  /** Automatic purge schedule */
  purgeSchedule: PurgeSchedule;
  /** Default sensitivity level for new entries */
  defaultSensitivity: SensitivityLevel;
}

/**
 * Default retention policies providing reasonable security defaults.
 */
export const DEFAULT_RETENTION_POLICIES: RetentionPolicy[] = [
  {
    sensitivityLevel: 'restricted',
    maxAgeMs: 24 * 60 * 60 * 1000, // 24 hours
    aggressiveStaleCleanup: true,
  },
  {
    sensitivityLevel: 'confidential',
    maxAgeMs: 7 * 24 * 60 * 60 * 1000, // 7 days
    aggressiveStaleCleanup: true,
  },
  {
    sensitivityLevel: 'internal',
    maxAgeMs: 30 * 24 * 60 * 60 * 1000, // 30 days
    aggressiveStaleCleanup: false,
  },
  {
    sensitivityLevel: 'public',
    maxAgeMs: 90 * 24 * 60 * 60 * 1000, // 90 days
    aggressiveStaleCleanup: false,
  },
];

/**
 * Default purge schedule configuration.
 */
export const DEFAULT_PURGE_SCHEDULE: PurgeSchedule = {
  intervalMs: 6 * 60 * 60 * 1000, // Every 6 hours
  enabled: false,
};

/**
 * Determines if a memory entry should be purged based on retention policies.
 */
export function shouldPurgeEntry(
  entry: MemoryEntry & { sensitivity?: SensitivityLevel },
  policies: RetentionPolicy[],
  now: number = Date.now(),
): { shouldPurge: boolean; reason?: string } {
  const entrySensitivity = entry.sensitivity ?? 'internal';

  for (const policy of policies) {
    if (policy.sensitivityLevel !== entrySensitivity) {
      continue;
    }

    if (policy.entryTypes && policy.entryTypes.length > 0) {
      if (!policy.entryTypes.includes(entry.type)) {
        continue;
      }
    }

    const age = now - entry.updatedAt;

    if (age > policy.maxAgeMs) {
      return {
        shouldPurge: true,
        reason: `Entry exceeded max age of ${policy.maxAgeMs}ms (age: ${age}ms)`,
      };
    }

    if (policy.aggressiveStaleCleanup && entry.stale) {
      const staleThreshold = policy.maxAgeMs / 4;
      if (age > staleThreshold) {
        return {
          shouldPurge: true,
          reason: `Stale entry exceeded aggressive threshold of ${staleThreshold}ms`,
        };
      }
    }
  }

  return { shouldPurge: false };
}

/**
 * Validates a retention policy configuration.
 */
export function validateRetentionPolicy(policy: RetentionPolicy): void {
  if (policy.maxAgeMs <= 0) {
    throw new MemoryError('Retention policy maxAgeMs must be positive', {
      details: { maxAgeMs: policy.maxAgeMs },
    });
  }

  const validSensitivities: SensitivityLevel[] = [
    'public',
    'internal',
    'confidential',
    'restricted',
  ];
  if (!validSensitivities.includes(policy.sensitivityLevel)) {
    throw new MemoryError('Invalid sensitivity level in retention policy', {
      details: { sensitivityLevel: policy.sensitivityLevel },
    });
  }
}

/**
 * Validates the entire hardening configuration.
 */
export function validateHardeningConfig(config: MemoryHardeningConfig): void {
  if (config.encryption.enabled && !config.encryption.keyEnv) {
    throw new MemoryError('Encryption is enabled but no key environment variable specified');
  }

  for (const policy of config.retentionPolicies) {
    validateRetentionPolicy(policy);
  }

  if (config.purgeSchedule.intervalMs < 60000) {
    throw new MemoryError('Purge schedule interval must be at least 60 seconds', {
      details: { intervalMs: config.purgeSchedule.intervalMs },
    });
  }
}

/**
 * Creates an empty purge result for initialization.
 */
export function createEmptyPurgeResult(): PurgeResult {
  return {
    purgedCount: 0,
    purgedByType: { procedural: 0, episodic: 0, semantic: 0 },
    purgedBySensitivity: { public: 0, internal: 0, confidential: 0, restricted: 0 },
    purgedAt: Date.now(),
    errors: [],
  };
}
