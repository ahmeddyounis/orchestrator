export declare class ConfigError extends Error {
    constructor(message: string);
}
export declare class RateLimitError extends Error {
    retryAfter?: number | undefined;
    constructor(message: string, retryAfter?: number | undefined);
}
export declare class TimeoutError extends Error {
    constructor(message: string);
}
export declare class ProcessError extends Error {
    constructor(message: string);
}
//# sourceMappingURL=errors.d.ts.map