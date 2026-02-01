export declare class PolicyDeniedError extends Error {
    constructor(message: string);
}
export declare class ConfirmationDeniedError extends Error {
    constructor(message: string);
}
export declare class TimeoutError extends Error {
    readonly partialStdout: string;
    readonly partialStderr: string;
    constructor(message: string, partialStdout: string, partialStderr: string);
}
export declare class ProcessError extends Error {
    readonly exitCode: number | null;
    readonly stdout: string;
    readonly stderr: string;
    constructor(message: string, exitCode: number | null, stdout: string, stderr: string);
}
//# sourceMappingURL=errors.d.ts.map