import { EventEmitter } from 'events';
import { Logger } from '@orchestrator/shared';
export interface ProcessManagerOptions {
    cwd?: string;
    env?: Record<string, string>;
    pty?: boolean;
    timeoutMs?: number;
    maxOutputSize?: number;
    logger?: Logger;
    runId?: string;
}
export interface ProcessOutput {
    type: 'stdout' | 'stderr';
    chunk: string;
}
export declare class ProcessManager extends EventEmitter {
    private options;
    private ptyProcess?;
    private childProcess?;
    private buffer;
    private outputSize;
    private isPty;
    private killed;
    private timeoutTimer?;
    private logger?;
    private runId?;
    private pid?;
    private startTime;
    constructor(options?: ProcessManagerOptions);
    get isRunning(): boolean;
    spawn(command: string[], cwd: string, env: Record<string, string>, usePty: boolean, inheritEnv?: boolean): Promise<void>;
    write(input: string): void;
    readUntil(predicate: (text: string) => boolean, timeoutMs?: number): Promise<string>;
    readUntilHeuristic(silenceDurationMs: number, predicate: (text: string) => boolean, timeoutMs?: number): Promise<string>;
    readStream(): AsyncGenerator<ProcessOutput, void, unknown>;
    kill(signal?: string): void;
    private handleOutput;
    private handleExit;
}
//# sourceMappingURL=process-manager.d.ts.map