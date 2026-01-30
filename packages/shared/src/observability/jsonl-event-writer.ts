import { type OrchestratorEvent, type EventWriter } from '../types/events';
import fs from 'fs';

export class JsonlEventWriter implements EventWriter {
  private readonly stream: fs.WriteStream;
  private closed = false;

  constructor(private readonly logPath: string) {
    this.stream = fs.createWriteStream(this.logPath, { flags: 'a' });
  }

  write(event: OrchestratorEvent) {
    if (this.closed) {
      // Maybe use a proper logger here in the future
      console.warn(`Attempted to write to closed trace writer: ${this.logPath}`);
      return;
    }
    this.stream.write(JSON.stringify(event) + '\n');
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (this.closed) {
        resolve();
        return;
      }
      this.closed = true;
      this.stream.end(() => resolve());
    });
  }
}
