import * as fs from 'fs/promises';
import path from 'path';
import { SecretScanner, redact } from '../security/secrets';
import type { Config } from '../config/schema';
import { ContextStackFrameSchema, type ContextStackFrame } from './types';

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '...[TRUNCATED]';
}

export class ContextStackStore {
  private readonly filePath: string;
  private readonly maxFrames: number;
  private readonly maxBytes: number;
  private readonly maxFieldChars: {
    title: number;
    summary: number;
    details: number;
  };
  private frames: ContextStackFrame[] = [];

  private readonly redactionEnabled: boolean;
  private readonly scanner?: SecretScanner;

  constructor(options: {
    filePath: string;
    security?: Config['security'];
    maxFrames?: number;
    maxBytes?: number;
    maxFieldChars?: Partial<ContextStackStore['maxFieldChars']>;
  }) {
    this.filePath = options.filePath;
    this.maxFrames = Math.max(1, Math.floor(options.maxFrames ?? 80));
    this.maxBytes = Math.max(10_000, Math.floor(options.maxBytes ?? 500_000));
    this.maxFieldChars = {
      title: Math.max(50, Math.floor(options.maxFieldChars?.title ?? 400)),
      summary: Math.max(200, Math.floor(options.maxFieldChars?.summary ?? 4_000)),
      details: Math.max(500, Math.floor(options.maxFieldChars?.details ?? 12_000)),
    };

    this.redactionEnabled = options.security?.redaction?.enabled ?? false;
    if (this.redactionEnabled) {
      this.scanner = new SecretScanner();
    }
  }

  static resolvePath(repoRoot: string, config?: Config): string {
    const configured = config?.contextStack?.path;
    if (configured && path.isAbsolute(configured)) return configured;
    const relative = configured ?? path.join('.orchestrator', 'context_stack.jsonl');
    return path.join(repoRoot, relative);
  }

  getAllFrames(): ContextStackFrame[] {
    return [...this.frames];
  }

  async load(): Promise<ContextStackFrame[]> {
    this.frames = [];

    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

      for (const line of lines) {
        try {
          const parsed: unknown = JSON.parse(line);
          const validated = ContextStackFrameSchema.safeParse(parsed);
          if (validated.success) this.frames.push(validated.data);
        } catch {
          // ignore malformed lines
        }
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException | undefined)?.code;
      if (code !== 'ENOENT') throw err;
    }

    this.frames = this.frames.slice(-this.maxFrames);
    return this.getAllFrames();
  }

  async append(frame: ContextStackFrame): Promise<void> {
    const sanitized = this.sanitizeFrame(frame);

    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.appendFile(this.filePath, JSON.stringify(sanitized) + '\n', 'utf8');
    this.frames.push(sanitized);
    this.frames = this.frames.slice(-this.maxFrames);

    await this.compactIfNeeded();
  }

  async snapshotTo(snapshotPath: string): Promise<void> {
    await fs.mkdir(path.dirname(snapshotPath), { recursive: true });
    const content = this.frames.map((f) => JSON.stringify(f)).join('\n') + (this.frames.length ? '\n' : '');
    await fs.writeFile(snapshotPath, content, 'utf8');
  }

  private sanitizeFrame(frame: ContextStackFrame): ContextStackFrame {
    const sanitizeText = (text: string, maxChars: number): string => {
      let result = truncate(text, maxChars);
      if (this.redactionEnabled && this.scanner) {
        const findings = this.scanner.scan(result);
        if (findings.length > 0) result = redact(result, findings);
      }
      return result;
    };

    const sanitized: ContextStackFrame = {
      ...frame,
      title: sanitizeText(frame.title, this.maxFieldChars.title),
      summary: sanitizeText(frame.summary, this.maxFieldChars.summary),
    };

    if (frame.details) {
      sanitized.details = sanitizeText(frame.details, this.maxFieldChars.details);
    }

    if (frame.artifacts) {
      sanitized.artifacts = frame.artifacts.map((a) => sanitizeText(a, this.maxFieldChars.summary));
    }

    return sanitized;
  }

  private async compactIfNeeded(): Promise<void> {
    let stat;
    try {
      stat = await fs.stat(this.filePath);
    } catch {
      return;
    }

    if (stat.size <= this.maxBytes && this.frames.length <= this.maxFrames) return;

    const keep = this.frames.slice(-this.maxFrames);
    const tmpPath = `${this.filePath}.tmp`;
    const content = keep.map((f) => JSON.stringify(f)).join('\n') + (keep.length ? '\n' : '');
    await fs.writeFile(tmpPath, content, 'utf8');
    await fs.rename(tmpPath, this.filePath);
  }
}
