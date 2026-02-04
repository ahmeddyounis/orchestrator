import { ConfigError, RateLimitError, TimeoutError } from './errors';

/**
 * Interface for API error types that have a status code.
 * Used by the base adapter to handle common error mapping.
 */
export interface APIErrorLike {
  status?: number;
  message: string;
}

/**
 * Configuration for error type checking in provider adapters.
 * Each provider can supply its own error class checks.
 */
export interface ErrorTypeConfig {
  /** Check if the error is an API error with status code */
  isAPIError: (error: unknown) => error is APIErrorLike;
  /** Check if the error is a connection timeout error */
  isTimeoutError: (error: unknown) => boolean;
}

/**
 * Base class for LLM provider adapters that provides common error mapping logic.
 * Subclasses should configure error type checks for their specific SDK.
 */
export abstract class BaseProviderAdapter {
  protected abstract readonly errorConfig: ErrorTypeConfig;

  /**
   * Maps provider-specific errors to standardized adapter errors.
   * Handles common cases:
   * - 429 status -> RateLimitError
   * - 401 status -> ConfigError
   * - Timeout errors -> TimeoutError
   * - Other errors -> passed through or wrapped
   *
   * @param error - The error thrown by the provider SDK
   * @returns A standardized error instance
   */
  protected mapError(error: unknown): Error {
    // Check for API errors with status codes
    if (this.errorConfig.isAPIError(error)) {
      if (error.status === 429) {
        return new RateLimitError(error.message);
      }
      if (error.status === 401) {
        return new ConfigError(error.message);
      }
    }

    // Check for timeout errors
    if (this.errorConfig.isTimeoutError(error)) {
      return new TimeoutError(error instanceof Error ? error.message : String(error));
    }

    // Pass through or wrap other errors
    if (error instanceof Error) return error;
    return new Error(String(error));
  }
}
