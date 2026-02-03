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

export interface AppErrorOptions {
  cause?: unknown;
  details?: Record<string, unknown> | string;
}

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly details?: Record<string, unknown> | string;
  public readonly cause?: unknown;

  constructor(code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.details = options.details;
    this.cause = options.cause;
  }
}

export class ConfigError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super('ConfigError', message, options);
  }
}

export class UsageError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super('UsageError', message, options);
  }
}

export class ProviderError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super('ProviderError', message, options);
  }
}

export class ToolError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super('ToolError', message, options);
  }
}

export class PatchOpError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super('PatchError', message, options);
  }
}

export class VerificationError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super('VerificationError', message, options);
  }
}

export class IndexError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super('IndexError', message, options);
  }
}

export class MemoryError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super('MemoryError', message, options);
  }
}

export class HttpError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super('HttpError', message, options);
  }
}

export class RateLimitError extends AppError {
  public readonly retryAfter?: number;

  constructor(message: string, options: AppErrorOptions & { retryAfter?: number } = {}) {
    super('RateLimitError', message, options);
    this.retryAfter = options.retryAfter;
  }
}

export class TimeoutError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super('TimeoutError', message, options);
  }
}

export class ProcessError extends AppError {
  public readonly exitCode?: number;

  constructor(message: string, options: AppErrorOptions & { exitCode?: number } = {}) {
    super('ProcessError', message, options);
    this.exitCode = options.exitCode;
  }
}

export class PolicyDeniedError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super('PolicyError', message, options);
  }
}

export class ConfirmationDeniedError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super('PolicyError', message, options);
  }
}

export class BudgetExceededError extends AppError {
  public readonly reason: string;

  constructor(reason: string, options: AppErrorOptions = {}) {
    super('BudgetError', `Budget exceeded: ${reason}`, options);
    this.reason = reason;
  }
}

export class RegistryError extends ConfigError {
  public readonly exitCode = 2;
}

export class IndexCorruptedError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super('IndexError', message, options);
  }
}

export class IndexNotFoundError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super('IndexError', message, options);
  }
}

export class VectorBackendNotImplementedError extends AppError {
  constructor(backend: string, options: AppErrorOptions = {}) {
    super('MemoryError', `Vector backend "${backend}" is not implemented.`, options);
  }
}

export class RemoteBackendNotAllowedError extends AppError {
  constructor(backend: string, options: AppErrorOptions = {}) {
    super('MemoryError', `Remote vector backend "${backend}" requires explicit opt-in.`, options);
  }
}

export class PluginValidationError extends AppError {
  public readonly pluginName: string;

  constructor(pluginName: string, message: string, options: AppErrorOptions = {}) {
    super('PluginError', `Plugin "${pluginName}": ${message}`, options);
    this.pluginName = pluginName;
  }
}
