"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProcessError = exports.TimeoutError = exports.ConfirmationDeniedError = exports.PolicyDeniedError = void 0;
class PolicyDeniedError extends Error {
    constructor(message) {
        super(message);
        this.name = 'PolicyDeniedError';
    }
}
exports.PolicyDeniedError = PolicyDeniedError;
class ConfirmationDeniedError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ConfirmationDeniedError';
    }
}
exports.ConfirmationDeniedError = ConfirmationDeniedError;
class TimeoutError extends Error {
    partialStdout;
    partialStderr;
    constructor(message, partialStdout, partialStderr) {
        super(message);
        this.partialStdout = partialStdout;
        this.partialStderr = partialStderr;
        this.name = 'TimeoutError';
    }
}
exports.TimeoutError = TimeoutError;
class ProcessError extends Error {
    exitCode;
    stdout;
    stderr;
    constructor(message, exitCode, stdout, stderr) {
        super(message);
        this.exitCode = exitCode;
        this.stdout = stdout;
        this.stderr = stderr;
        this.name = 'ProcessError';
    }
}
exports.ProcessError = ProcessError;
//# sourceMappingURL=errors.js.map