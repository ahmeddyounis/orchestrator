import * as fs from 'fs/promises';
import { OrchestratorEvent } from '../types/events';
import { redactForLogs } from '../redaction';
import type { Logger } from './types';

export class JsonlLogger implements Logger {
  private filePath: string;
  private readonly bindings: Record<string, unknown>;

  constructor(filePath: string, bindings: Record<string, unknown> = {}) {
    this.filePath = filePath;
    this.bindings = bindings;
  }

  async log(event: OrchestratorEvent): Promise<void> {
    const redactedEvent = redactForLogs(event);
    const line = JSON.stringify(redactedEvent) + '\n';
    try {
      await fs.appendFile(this.filePath, line, 'utf8');
    } catch (error) {
      console.error(`Failed to write to log file at ${this.filePath}`, error);
      // Depending on requirements, we might want to throw or just log to stderr
    }
  }

  async trace(event: OrchestratorEvent, _message: string): Promise<void> {
    await this.log(event);
  }

  debug(message: string): void {
    // Best-effort: do not fail the run due to logging.
    console.debug(this.withPrefix(message));
  }

  info(message: string): void {
    console.info(this.withPrefix(message));
  }

  warn(message: string): void {
    console.warn(this.withPrefix(message));
  }

  error(error: Error, message?: string): void {
    if (message) {
      console.error(this.withPrefix(message), error);
    } else {
      console.error(error);
    }
  }

  child(bindings: Record<string, unknown>): Logger {
    return new JsonlLogger(this.filePath, { ...this.bindings, ...bindings });
  }

  private withPrefix(message: string): string {
    const prefix = Object.entries(this.bindings)
      .map(([k, v]) => `${k}=${String(v)}`)
      .join(' ');
    return prefix ? `[${prefix}] ${message}` : message;
  }
}
