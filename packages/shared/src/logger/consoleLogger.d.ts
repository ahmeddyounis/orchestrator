import { OrchestratorEvent } from '../types/events';
export interface Logger {
  log(event: OrchestratorEvent): void;
  trace(event: OrchestratorEvent, message: string): void;
  error(error: Error, message?: string): void;
}
export declare class ConsoleLogger implements Logger {
  log(event: OrchestratorEvent): void;
  trace(event: OrchestratorEvent, message: string): void;
  error(error: Error, message?: string): void;
}
//# sourceMappingURL=consoleLogger.d.ts.map
