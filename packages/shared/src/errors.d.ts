export type ErrorCode = 'ConfigError' | 'UsageError' | 'ProviderError' | 'ToolError' | 'PatchError' | 'VerificationError' | 'IndexError' | 'MemoryError' | 'HttpError' | 'UnknownError';
export interface AppErrorOptions {
    cause?: unknown;
    details?: Record<string, unknown> | string;
}
export declare class AppError extends Error {
    readonly code: ErrorCode;
    readonly details?: Record<string, unknown> | string;
    readonly cause?: unknown;
    constructor(code: ErrorCode, message: string, options?: AppErrorOptions);
}
export declare class ConfigError extends AppError {
    constructor(message: string, options?: AppErrorOptions);
}
export declare class UsageError extends AppError {
    constructor(message: string, options?: AppErrorOptions);
}
export declare class ProviderError extends AppError {
    constructor(message: string, options?: AppErrorOptions);
}
export declare class ToolError extends AppError {
    constructor(message: string, options?: AppErrorOptions);
}
export declare class PatchOpError extends AppError {
    constructor(message: string, options?: AppErrorOptions);
}
export declare class VerificationError extends AppError {
    constructor(message: string, options?: AppErrorOptions);
}
export declare class IndexError extends AppError {
    constructor(message: string, options?: AppErrorOptions);
}
export declare class MemoryError extends AppError {
    constructor(message: string, options?: AppErrorOptions);
}
export declare class HttpError extends AppError {
    constructor(message: string, options?: AppErrorOptions);
}
//# sourceMappingURL=errors.d.ts.map