import { describe, it, expect } from 'vitest';
import {
  AppError,
  ConfigError,
  UsageError,
  ProviderError,
  ToolError,
  PatchOpError,
  VerificationError,
  IndexError,
  MemoryError,
  HttpError,
  RateLimitError,
  TimeoutError,
  ProcessError,
  PolicyDeniedError,
  ConfirmationDeniedError,
  BudgetExceededError,
  RegistryError,
  IndexCorruptedError,
  IndexNotFoundError,
  VectorBackendNotImplementedError,
  RemoteBackendNotAllowedError,
  PluginValidationError,
} from './errors';

describe('AppError', () => {
  it('should create an error with code and message', () => {
    const error = new AppError('ConfigError', 'Test message');
    expect(error.code).toBe('ConfigError');
    expect(error.message).toBe('Test message');
    expect(error.name).toBe('AppError');
  });

  it('should accept optional cause and details', () => {
    const cause = new Error('Original error');
    const details = { key: 'value' };
    const error = new AppError('ProviderError', 'Test message', { cause, details });
    expect(error.cause).toBe(cause);
    expect(error.details).toEqual(details);
  });

  it('should accept string details', () => {
    const error = new AppError('ToolError', 'Test', { details: 'string details' });
    expect(error.details).toBe('string details');
  });
});

describe('ConfigError', () => {
  it('should create a ConfigError with correct code', () => {
    const error = new ConfigError('Invalid config');
    expect(error.code).toBe('ConfigError');
    expect(error.message).toBe('Invalid config');
    expect(error.name).toBe('ConfigError');
  });
});

describe('UsageError', () => {
  it('should create a UsageError with correct code', () => {
    const error = new UsageError('Invalid usage');
    expect(error.code).toBe('UsageError');
    expect(error.message).toBe('Invalid usage');
  });
});

describe('ProviderError', () => {
  it('should create a ProviderError with correct code', () => {
    const error = new ProviderError('Provider failed');
    expect(error.code).toBe('ProviderError');
  });
});

describe('ToolError', () => {
  it('should create a ToolError with correct code', () => {
    const error = new ToolError('Tool execution failed');
    expect(error.code).toBe('ToolError');
  });
});

describe('PatchOpError', () => {
  it('should create a PatchOpError with PatchError code', () => {
    const error = new PatchOpError('Patch failed');
    expect(error.code).toBe('PatchError');
  });
});

describe('VerificationError', () => {
  it('should create a VerificationError with correct code', () => {
    const error = new VerificationError('Verification failed');
    expect(error.code).toBe('VerificationError');
  });
});

describe('IndexError', () => {
  it('should create an IndexError with correct code', () => {
    const error = new IndexError('Index failed');
    expect(error.code).toBe('IndexError');
  });
});

describe('MemoryError', () => {
  it('should create a MemoryError with correct code', () => {
    const error = new MemoryError('Memory failed');
    expect(error.code).toBe('MemoryError');
  });
});

describe('HttpError', () => {
  it('should create an HttpError with correct code', () => {
    const error = new HttpError('HTTP request failed');
    expect(error.code).toBe('HttpError');
  });
});

describe('RateLimitError', () => {
  it('should create a RateLimitError with correct code', () => {
    const error = new RateLimitError('Rate limited');
    expect(error.code).toBe('RateLimitError');
  });

  it('should accept retryAfter option', () => {
    const error = new RateLimitError('Rate limited', { retryAfter: 60 });
    expect(error.retryAfter).toBe(60);
  });
});

describe('TimeoutError', () => {
  it('should create a TimeoutError with correct code', () => {
    const error = new TimeoutError('Operation timed out');
    expect(error.code).toBe('TimeoutError');
  });
});

describe('ProcessError', () => {
  it('should create a ProcessError with correct code', () => {
    const error = new ProcessError('Process failed');
    expect(error.code).toBe('ProcessError');
  });

  it('should accept exitCode option', () => {
    const error = new ProcessError('Process failed', { exitCode: 1 });
    expect(error.exitCode).toBe(1);
  });
});

describe('PolicyDeniedError', () => {
  it('should create a PolicyDeniedError with PolicyError code', () => {
    const error = new PolicyDeniedError('Policy denied');
    expect(error.code).toBe('PolicyError');
  });
});

describe('ConfirmationDeniedError', () => {
  it('should create a ConfirmationDeniedError with PolicyError code', () => {
    const error = new ConfirmationDeniedError('Confirmation denied');
    expect(error.code).toBe('PolicyError');
  });
});

describe('BudgetExceededError', () => {
  it('should create a BudgetExceededError with correct code and reason', () => {
    const error = new BudgetExceededError('cost limit reached');
    expect(error.code).toBe('BudgetError');
    expect(error.message).toBe('Budget exceeded: cost limit reached');
    expect(error.reason).toBe('cost limit reached');
  });
});

describe('RegistryError', () => {
  it('should be a ConfigError with exitCode 2', () => {
    const error = new RegistryError('Registry failed');
    expect(error.code).toBe('ConfigError');
    expect(error.exitCode).toBe(2);
  });
});

describe('IndexCorruptedError', () => {
  it('should create an IndexCorruptedError with IndexError code', () => {
    const error = new IndexCorruptedError('Index corrupted');
    expect(error.code).toBe('IndexError');
  });
});

describe('IndexNotFoundError', () => {
  it('should create an IndexNotFoundError with IndexError code', () => {
    const error = new IndexNotFoundError('Index not found');
    expect(error.code).toBe('IndexError');
  });
});

describe('VectorBackendNotImplementedError', () => {
  it('should create error with correct message', () => {
    const error = new VectorBackendNotImplementedError('fake-backend');
    expect(error.code).toBe('MemoryError');
    expect(error.message).toBe('Vector backend "fake-backend" is not implemented.');
  });
});

describe('RemoteBackendNotAllowedError', () => {
  it('should create error with correct message', () => {
    const error = new RemoteBackendNotAllowedError('qdrant');
    expect(error.code).toBe('MemoryError');
    expect(error.message).toBe('Remote vector backend "qdrant" requires explicit opt-in.');
  });
});

describe('PluginValidationError', () => {
  it('should create error with plugin name and message', () => {
    const error = new PluginValidationError('my-plugin', 'invalid manifest');
    expect(error.code).toBe('PluginError');
    expect(error.message).toBe('Plugin "my-plugin": invalid manifest');
    expect(error.pluginName).toBe('my-plugin');
  });
});
