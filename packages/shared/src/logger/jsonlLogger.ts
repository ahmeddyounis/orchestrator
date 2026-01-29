import * as fs from 'fs/promises';
import { OrchestratorEvent } from '../types/events';
import { redact } from './redactor';

export interface Logger {
  log(event: OrchestratorEvent): Promise<void>;
}

export class JsonlLogger implements Logger {
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async log(event: OrchestratorEvent): Promise<void> {
    const redactedEvent = redact(event);
    const line = JSON.stringify(redactedEvent) + '\n';
    try {
      await fs.appendFile(this.filePath, line, 'utf8');
    } catch (error) {
      console.error(`Failed to write to log file at ${this.filePath}`, error);
      // Depending on requirements, we might want to throw or just log to stderr
    }
  }
}
