import { OrchestratorEvent } from '../types/events';

export interface Logger {
  log(event: OrchestratorEvent): void;
  trace(event: OrchestratorEvent, message: string): void;
  error(error: Error, message?: string): void;
}

export class ConsoleLogger implements Logger {
  log(event: OrchestratorEvent): void {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(event));
  }

  trace(event: OrchestratorEvent, message: string): void {
    // eslint-disable-next-line no-console
    console.log(message, JSON.stringify(event));
  }

  error(error: Error, message?: string): void {
    if (message) {
      // eslint-disable-next-line no-console
      console.error(message, error);
    } else {
      // eslint-disable-next-line no-console
      console.error(error);
    }
  }
}
