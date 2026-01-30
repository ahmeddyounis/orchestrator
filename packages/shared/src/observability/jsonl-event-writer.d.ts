import { type OrchestratorEvent, type EventWriter } from '../types/events';
export declare class JsonlEventWriter implements EventWriter {
    private readonly logPath;
    private readonly stream;
    private closed;
    constructor(logPath: string);
    write(event: OrchestratorEvent): void;
    close(): Promise<void>;
}
//# sourceMappingURL=jsonl-event-writer.d.ts.map