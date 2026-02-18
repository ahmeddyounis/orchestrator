/**
 * Error codes used throughout the orchestrator system.
 * User-correctable errors use exit code 2.
 * Runtime errors use exit code 1.
 */
export type ErrorCode =
  // User-correctable errors (exit code 2)
  | 'ConfigError'
  | 'UsageError'
  // Runtime errors (exit code 1)
  | 'ProviderError'
  | 'ToolError'
  | 'PatchError'
  | 'VerificationError'
  | 'IndexError'
  | 'MemoryError'
  | 'HttpError'
  | 'RateLimitError'
  | 'TimeoutError'
  | 'ProcessError'
  | 'PolicyError'
  | 'BudgetError'
  | 'PluginError'
  | 'UnknownError';

/**
 * Options for constructing an AppError.
 */
export interface AppErrorOptions {
  /** The underlying cause of this error */
  cause?: unknown;
  /** Additional error details (structured or string) */
  details?: Record<string, unknown> | string;
}

/**
 * Base error class for all orchestrator errors.
 * Provides consistent error handling with codes, causes, and details.
 *
 * @example
 * ```typescript
 * throw new AppError('ProviderError', 'API request failed', {
 *   cause: originalError,
 *   details: { statusCode: 500, provider: 'openai' }
 * });
 * ```
 */
export class AppError extends Error {
  /** Error classification code */
  public readonly code: ErrorCode;
  /** Additional error details */
  public readonly details?: Record<string, unknown> | string;
  /** The underlying cause of this error */
  public readonly cause?: unknown;

  constructor(code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.details = options.details;
    this.cause = options.cause;
  }
}

/**
 * Error thrown when configuration is invalid or missing.
 * User-correctable - suggests fixing configuration files.
 */
export class ConfigError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super('ConfigError', message, options);
  }
}

/**
 * Error thrown when CLI usage is incorrect.
 * User-correctable - suggests correct usage.
 */
export class UsageError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super('UsageError', message, options);
  }
}

/**
 * Error thrown when an LLM provider fails.
 * May be retryable depending on the underlying cause.
 */
export class ProviderError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super('ProviderError', message, options);
  }
}

/**
 * Error thrown when a tool execution fails.
 */
export class ToolError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super('ToolError', message, options);
  }
}

/**
 * Error thrown when a patch operation fails.
 */
export class PatchOpError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super('PatchError', message, options);
  }
}

/**
 * Error thrown when verification fails.
 */
export class VerificationError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super('VerificationError', message, options);
  }
}

/**
 * Error thrown when index operations fail.
 */
export class IndexError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super('IndexError', message, options);
  }
}

/**
 * Error thrown when memory operations fail.
 */
export class MemoryError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super('MemoryError', message, options);
  }
}

/**
 * Error thrown for HTTP-related failures.
 */
export class HttpError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super('HttpError', message, options);
  }
}

/**
 * Error thrown when rate limited by an API.
 * Includes optional retry-after information.
 */
export class RateLimitError extends AppError {
  /** Suggested wait time in seconds before retrying */
  public readonly retryAfter?: number;

  constructor(message: string, options: AppErrorOptions & { retryAfter?: number } = {}) {
    super('RateLimitError', message, options);
    this.retryAfter = options.retryAfter;
  }
}

/**
 * Error thrown when an operation times out.
 */
export class TimeoutError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super('TimeoutError', message, options);
  }
}

/**
 * Error thrown when a subprocess fails.
 * Includes the process exit code when available.
 */
export class ProcessError extends AppError {
  /** Exit code of the failed process */
  public readonly exitCode?: number;

  constructor(message: string, options: AppErrorOptions & { exitCode?: number } = {}) {
    super('ProcessError', message, options);
    this.exitCode = options.exitCode;
  }
}

/**
 * Error thrown when an operation is denied by policy.
 */
export class PolicyDeniedError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super('PolicyError', message, options);
  }
}

/**
 * Error thrown when a user denies a confirmation request.
 */
export class ConfirmationDeniedError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super('PolicyError', message, options);
  }
}

/**
 * Error thrown when a budget limit is exceeded.
 */
export class BudgetExceededError extends AppError {
  /** The specific budget that was exceeded */
  public readonly reason: string;

  constructor(reason: string, options: AppErrorOptions = {}) {
    super('BudgetError', `Budget exceeded: ${reason}`, options);
    this.reason = reason;
  }
}

/**
 * Error thrown when provider registry operations fail.
 * Extends ConfigError as it's usually a configuration issue.
 */
export class RegistryError extends ConfigError {
  public readonly exitCode = 2;
}

/**
 * Error thrown when the repository index is corrupted.
 */
export class IndexCorruptedError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super('IndexError', message, options);
  }
}

/**
 * Error thrown when a required index is not found.
 */
export class IndexNotFoundError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super('IndexError', message, options);
  }
}

/**
 * Error thrown when a vector backend type is not implemented.
 */
export class VectorBackendNotImplementedError extends AppError {
  constructor(backend: string, options: AppErrorOptions = {}) {
    super('MemoryError', `Vector backend "${backend}" is not implemented.`, options);
  }
}

/**
 * Error thrown when trying to use a remote backend without explicit opt-in.
 */
export class RemoteBackendNotAllowedError extends AppError {
  constructor(backend: string, options: AppErrorOptions = {}) {
    super('MemoryError', `Remote vector backend "${backend}" requires explicit opt-in.`, options);
  }
}

/**
 * Error thrown when plugin validation fails.
 */
export class PluginValidationError extends AppError {
  /** Name of the plugin that failed validation */
  public readonly pluginName: string;

  constructor(pluginName: string, message: string, options: AppErrorOptions = {}) {
    super('PluginError', `Plugin "${pluginName}": ${message}`, options);
    this.pluginName = pluginName;
  }
}

/**
 * Error thrown when plugin signature verification fails.
 */
export class PluginSignatureError extends AppError {
  /** Name of the plugin that failed verification */
  public readonly pluginName: string;

  constructor(pluginName: string, message: string, options: AppErrorOptions = {}) {
    super('PluginError', `Plugin "${pluginName}" signature error: ${message}`, options);
    this.pluginName = pluginName;
  }
}

/**
 * Error thrown when plugin permissions are insufficient.
 */
export class PluginPermissionError extends AppError {
  /** Name of the plugin with permission issues */
  public readonly pluginName: string;
  /** Permissions that were missing */
  public readonly missingPermissions: string[];

  constructor(pluginName: string, missingPermissions: string[], options: AppErrorOptions = {}) {
    super(
      'PluginError',
      `Plugin "${pluginName}" missing permissions: ${missingPermissions.join(', ')}`,
      options,
    );
    this.pluginName = pluginName;
    this.missingPermissions = missingPermissions;
  }
}
