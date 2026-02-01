'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.HttpError =
  exports.MemoryError =
  exports.IndexError =
  exports.VerificationError =
  exports.PatchOpError =
  exports.ToolError =
  exports.ProviderError =
  exports.UsageError =
  exports.ConfigError =
  exports.AppError =
    void 0;
class AppError extends Error {
  code;
  details;
  cause;
  constructor(code, message, options = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.details = options.details;
    this.cause = options.cause;
  }
}
exports.AppError = AppError;
class ConfigError extends AppError {
  constructor(message, options = {}) {
    super('ConfigError', message, options);
  }
}
exports.ConfigError = ConfigError;
class UsageError extends AppError {
  constructor(message, options = {}) {
    super('UsageError', message, options);
  }
}
exports.UsageError = UsageError;
class ProviderError extends AppError {
  constructor(message, options = {}) {
    super('ProviderError', message, options);
  }
}
exports.ProviderError = ProviderError;
class ToolError extends AppError {
  constructor(message, options = {}) {
    super('ToolError', message, options);
  }
}
exports.ToolError = ToolError;
class PatchOpError extends AppError {
  constructor(message, options = {}) {
    super('PatchError', message, options);
  }
}
exports.PatchOpError = PatchOpError;
class VerificationError extends AppError {
  constructor(message, options = {}) {
    super('VerificationError', message, options);
  }
}
exports.VerificationError = VerificationError;
class IndexError extends AppError {
  constructor(message, options = {}) {
    super('IndexError', message, options);
  }
}
exports.IndexError = IndexError;
class MemoryError extends AppError {
  constructor(message, options = {}) {
    super('MemoryError', message, options);
  }
}
exports.MemoryError = MemoryError;
class HttpError extends AppError {
  constructor(message, options = {}) {
    super('HttpError', message, options);
  }
}
exports.HttpError = HttpError;
//# sourceMappingURL=errors.js.map
