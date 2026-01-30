import { OrchestratorEvent } from '../types/events';
export interface Logger {
    log(event: OrchestratorEvent): Promise<void>;
}
export declare class JsonlLogger implements Logger {
    private filePath;
    constructor(filePath: string);
    log(event: OrchestratorEvent): Promise<void>;
}
//# sourceMappingURL=jsonlLogger.d.ts.map