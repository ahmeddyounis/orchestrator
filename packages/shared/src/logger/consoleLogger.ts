import { OrchestratorEvent } from '../types/events';
import type { Logger } from './types';

export class ConsoleLogger implements Logger {
  log(event: OrchestratorEvent): void {
    console.log(JSON.stringify(event));
  }

  trace(event: OrchestratorEvent, message: string): void {
    console.log(message, JSON.stringify(event));
  }

  debug(message: string): void {
    console.debug(message);
  }

  info(message: string): void {
    console.info(message);
  }

  warn(message: string): void {
    console.warn(message);
  }

  error(error: Error, message?: string): void {
    if (message) {
      console.error(message, error);
    } else {
      console.error(error);
    }
  }

  child(bindings: Record<string, unknown>): Logger {
    return new ScopedLogger(this, bindings);
  }
}

class ScopedLogger implements Logger {
  constructor(
    private readonly base: Logger,
    private readonly bindings: Record<string, unknown>,
  ) {}

  log(event: OrchestratorEvent) {
    return this.base.log(event);
  }

  trace(event: OrchestratorEvent, message: string) {
    return this.base.trace(event, this.withPrefix(message));
  }

  debug(message: string) {
    return this.base.debug(this.withPrefix(message));
  }

  info(message: string) {
    return this.base.info(this.withPrefix(message));
  }

  warn(message: string) {
    return this.base.warn(this.withPrefix(message));
  }

  error(error: Error, message?: string) {
    return this.base.error(error, message ? this.withPrefix(message) : undefined);
  }

  child(bindings: Record<string, unknown>): Logger {
    return new ScopedLogger(this.base, { ...this.bindings, ...bindings });
  }

  private withPrefix(message: string): string {
    const prefix = Object.entries(this.bindings)
      .map(([k, v]) => `${k}=${String(v)}`)
      .join(' ');
    return prefix ? `[${prefix}] ${message}` : message;
  }
}
