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
