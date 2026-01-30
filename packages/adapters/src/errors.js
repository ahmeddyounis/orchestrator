'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.ProcessError = exports.TimeoutError = exports.RateLimitError = exports.ConfigError = void 0;
class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}
exports.ConfigError = ConfigError;
class RateLimitError extends Error {
  retryAfter;
  constructor(message, retryAfter) {
    super(message);
    this.retryAfter = retryAfter;
    this.name = 'RateLimitError';
  }
}
exports.RateLimitError = RateLimitError;
class TimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TimeoutError';
  }
}
exports.TimeoutError = TimeoutError;
class ProcessError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProcessError';
  }
}
exports.ProcessError = ProcessError;
//# sourceMappingURL=errors.js.map
