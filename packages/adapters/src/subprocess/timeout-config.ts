import type { ToolClassification } from '@orchestrator/shared';

/**
 * Timeout configuration for a specific tool or tool category.
 */
export interface ToolTimeoutConfig {
  /** Maximum execution time in milliseconds */
  timeoutMs: number;
  /** Grace period for cleanup after timeout signal (ms) */
  gracePeriodMs?: number;
  /** Maximum memory usage in bytes (for resource limiting) */
  maxMemoryBytes?: number;
  /** Maximum CPU time in seconds (for resource limiting) */
  maxCpuSeconds?: number;
}

/**
 * Per-tool timeout configuration map.
 * Keys can be exact tool names or patterns (e.g., "npm:*" for all npm commands).
 */
export type ToolTimeoutConfigMap = Record<string, ToolTimeoutConfig>;

/**
 * Default timeout configurations by tool classification.
 * These provide sensible defaults based on the type of operation.
 */
export const DEFAULT_TIMEOUTS_BY_CLASSIFICATION: Record<ToolClassification, ToolTimeoutConfig> = {
  // Read-only operations should be fast
  read_only: {
    timeoutMs: 30_000, // 30 seconds
    gracePeriodMs: 5_000,
  },

  // Build operations can take a while (compilation, bundling)
  build: {
    timeoutMs: 600_000, // 10 minutes
    gracePeriodMs: 30_000,
    maxMemoryBytes: 4 * 1024 * 1024 * 1024, // 4GB
  },

  // Test operations need generous time for test suites
  test: {
    timeoutMs: 900_000, // 15 minutes
    gracePeriodMs: 30_000,
    maxMemoryBytes: 4 * 1024 * 1024 * 1024, // 4GB
  },

  // Formatting is typically fast
  format: {
    timeoutMs: 120_000, // 2 minutes
    gracePeriodMs: 10_000,
  },

  // Install operations can be slow due to network
  install: {
    timeoutMs: 600_000, // 10 minutes
    gracePeriodMs: 30_000,
  },

  // Network operations need reasonable timeout
  network: {
    timeoutMs: 300_000, // 5 minutes
    gracePeriodMs: 15_000,
  },

  // Destructive operations should be quick (but require confirmation)
  destructive: {
    timeoutMs: 60_000, // 1 minute
    gracePeriodMs: 10_000,
  },

  // Unknown operations get a conservative default
  unknown: {
    timeoutMs: 600_000, // 10 minutes (matches global default)
    gracePeriodMs: 30_000,
  },
};

/**
 * Default timeout configurations for common subprocess-based tools.
 * These can be overridden via configuration.
 */
export const DEFAULT_TOOL_TIMEOUTS: ToolTimeoutConfigMap = {
  // LLM CLI tools need very long timeouts
  'claude': {
    timeoutMs: 6_000_000, // 100 minutes
    gracePeriodMs: 60_000,
  },
  'claude-code': {
    timeoutMs: 6_000_000, // 100 minutes
    gracePeriodMs: 60_000,
  },
  'codex': {
    timeoutMs: 6_000_000, // 100 minutes
    gracePeriodMs: 60_000,
  },
  'gemini': {
    timeoutMs: 6_000_000, // 100 minutes
    gracePeriodMs: 60_000,
  },

  // Package managers
  'npm': {
    timeoutMs: 600_000, // 10 minutes
    gracePeriodMs: 30_000,
  },
  'pnpm': {
    timeoutMs: 600_000, // 10 minutes
    gracePeriodMs: 30_000,
  },
  'yarn': {
    timeoutMs: 600_000, // 10 minutes
    gracePeriodMs: 30_000,
  },

  // Build tools
  'tsc': {
    timeoutMs: 300_000, // 5 minutes
    gracePeriodMs: 15_000,
  },
  'turbo': {
    timeoutMs: 900_000, // 15 minutes
    gracePeriodMs: 30_000,
  },
  'vite': {
    timeoutMs: 300_000, // 5 minutes
    gracePeriodMs: 15_000,
  },
  'webpack': {
    timeoutMs: 600_000, // 10 minutes
    gracePeriodMs: 30_000,
  },

  // Test runners
  'vitest': {
    timeoutMs: 900_000, // 15 minutes
    gracePeriodMs: 30_000,
  },
  'jest': {
    timeoutMs: 900_000, // 15 minutes
    gracePeriodMs: 30_000,
  },
  'mocha': {
    timeoutMs: 900_000, // 15 minutes
    gracePeriodMs: 30_000,
  },

  // Linters
  'eslint': {
    timeoutMs: 300_000, // 5 minutes
    gracePeriodMs: 15_000,
  },
  'prettier': {
    timeoutMs: 120_000, // 2 minutes
    gracePeriodMs: 10_000,
  },
};

/** Global fallback timeout when no specific config is found */
export const GLOBAL_DEFAULT_TIMEOUT: ToolTimeoutConfig = {
  timeoutMs: 600_000, // 10 minutes
  gracePeriodMs: 30_000,
};

/**
 * Resolves the timeout configuration for a given tool.
 *
 * Resolution order:
 * 1. Exact tool name match in custom config
 * 2. Exact tool name match in defaults
 * 3. Classification-based default
 * 4. Global fallback
 */
export function resolveToolTimeout(
  toolName: string,
  classification?: ToolClassification,
  customConfig?: ToolTimeoutConfigMap,
): ToolTimeoutConfig {
  // 1. Check custom config first
  if (customConfig?.[toolName]) {
    return customConfig[toolName];
  }

  // 2. Check default tool timeouts
  if (DEFAULT_TOOL_TIMEOUTS[toolName]) {
    return DEFAULT_TOOL_TIMEOUTS[toolName];
  }

  // 3. Use classification-based default
  if (classification && DEFAULT_TIMEOUTS_BY_CLASSIFICATION[classification]) {
    return DEFAULT_TIMEOUTS_BY_CLASSIFICATION[classification];
  }

  // 4. Global fallback
  return GLOBAL_DEFAULT_TIMEOUT;
}
