import * as pty from 'node-pty';
import { spawn as spawnChild, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import {
  Logger,
  SubprocessSpawned,
  SubprocessOutputChunked,
  SubprocessExited,
} from '@orchestrator/shared';

export interface ProcessManagerOptions {
  cwd?: string;
  env?: Record<string, string>;
  pty?: boolean;
  timeoutMs?: number; // Max duration for the process
  maxOutputSize?: number; // Max bytes to buffer/allow
  logger?: Logger;
  runId?: string; // For event tagging
}

export interface ProcessOutput {
  type: 'stdout' | 'stderr';
  chunk: string;
}

export class ProcessManager extends EventEmitter {
  private ptyProcess?: pty.IPty;
  private childProcess?: ChildProcess;
  private buffer: string = '';
  private outputSize = 0;
  private isPty = false;
  private killed = false;
  private timeoutTimer?: NodeJS.Timeout;
  private logger?: Logger;
  private runId?: string;
  private pid?: number;
  private startTime = 0;

  constructor(private options: ProcessManagerOptions = {}) {
    super();
    this.logger = options.logger;
    this.runId = options.runId || 'unknown';
  }

  public get isRunning(): boolean {
    return !this.killed;
  }

  async spawn(
    command: string[],
    cwd: string,
    env: Record<string, string>,
    usePty: boolean,
    inheritEnv: boolean = true,
  ): Promise<void> {
    if (this.ptyProcess || this.childProcess) {
      throw new Error('Process already running');
    }

    this.isPty = usePty;
    this.startTime = Date.now();
    const cmd = command[0];
    const args = command.slice(1);

    // Ensure env has basic PATH if not provided or merged
    const rawEnv = inheritEnv ? { ...process.env, ...env } : env;
    const sanitizedEnv: Record<string, string> = {};
    for (const key in rawEnv) {
      const val = rawEnv[key];
      if (val !== undefined) {
        sanitizedEnv[key] = String(val);
      }
    }

    if (this.isPty) {
      this.ptyProcess = pty.spawn(cmd, args, {
        name: 'xterm-color',
        cols: 80,
        rows: 30,
        cwd,
        env: sanitizedEnv,
      });
      this.pid = this.ptyProcess.pid;

      this.ptyProcess.onData((data) => this.handleOutput(data, 'stdout'));
      this.ptyProcess.onExit((e) => this.handleExit(e.exitCode, e.signal ?? null));
    } else {
      this.childProcess = spawnChild(cmd, args, {
        cwd,
        env: sanitizedEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this.pid = this.childProcess.pid;

      if (this.childProcess.stdout) {
        this.childProcess.stdout.setEncoding('utf8');
        this.childProcess.stdout.on('data', (data) => this.handleOutput(data.toString(), 'stdout'));
      }
      if (this.childProcess.stderr) {
        this.childProcess.stderr.setEncoding('utf8');
        this.childProcess.stderr.on('data', (data) => this.handleOutput(data.toString(), 'stderr'));
      }

      this.childProcess.on('close', (code, signal) => this.handleExit(code, signal));
      this.childProcess.on('error', (err) => {
        this.emit('error', err);
        // Ensure we clean up if spawn failed
        this.handleExit(1, null, err.message);
      });
    }

    // Start timeout
    if (this.options.timeoutMs) {
      this.timeoutTimer = setTimeout(() => {
        this.kill('SIGTERM'); // Try graceful first? Or SIGKILL?
        this.emit('timeout');
        // We might want to construct a specific error event
      }, this.options.timeoutMs);
    }

    // Emit Spawned Event
    // We emit internal events that the adapter can translate to Orchestrator events
    this.emit('spawned', {
      command,
      cwd,
      pid: this.pid,
      pty: this.isPty,
    });

    if (this.logger && this.pid) {
      const event: SubprocessSpawned = {
        type: 'SubprocessSpawned',
        runId: this.runId || '',
        timestamp: new Date().toISOString(),
        schemaVersion: 1,
        payload: {
          command,
          cwd,
          pid: this.pid,
          pty: this.isPty,
        },
      };
      this.logger.log(event);
    }
  }

  write(input: string): void {
    if (this.killed) return; // Or throw?

    if (this.isPty && this.ptyProcess) {
      this.ptyProcess.write(input);
    } else if (this.childProcess && this.childProcess.stdin) {
      this.childProcess.stdin.write(input);
    } else {
      throw new Error('Process not running');
    }
  }

  async readUntil(predicate: (text: string) => boolean, timeoutMs: number = 5000): Promise<string> {
    return new Promise((resolve, reject) => {
      // Check immediately in case we already have it
      if (predicate(this.buffer)) {
        const matched = this.buffer;
        this.buffer = ''; // Consume buffer
        resolve(matched);
        return;
      }

      // eslint-disable-next-line prefer-const
      let timer: NodeJS.Timeout;

      const cleanup = () => {
        this.off('output', check);
        this.off('exit', onExit);
        if (timer) clearTimeout(timer);
      };

      const check = () => {
        if (predicate(this.buffer)) {
          cleanup();
          const matched = this.buffer;
          this.buffer = ''; // Consume buffer
          resolve(matched);
        }
      };

      const onExit = () => {
        cleanup();
        reject(new Error('Process exited while waiting'));
      };

      this.on('output', check);
      this.on('exit', onExit);

      timer = setTimeout(() => {
        cleanup();
        reject(new Error(`readUntil timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });
  }

  async readUntilHeuristic(
    silenceDurationMs: number,
    predicate: (text: string) => boolean,
    timeoutMs: number = 30000,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      let silenceTimer: NodeJS.Timeout;
      // eslint-disable-next-line prefer-const
      let totalTimeoutTimer: NodeJS.Timeout;

      const cleanup = () => {
        this.off('output', onOutput);
        this.off('exit', onExit);
        if (silenceTimer) clearTimeout(silenceTimer);
        if (totalTimeoutTimer) clearTimeout(totalTimeoutTimer);
      };

      const check = () => {
        if (predicate(this.buffer)) {
          cleanup();
          const matched = this.buffer;
          this.buffer = '';
          resolve(matched);
        }
      };

      const resetSilenceTimer = () => {
        if (silenceTimer) clearTimeout(silenceTimer);
        silenceTimer = setTimeout(check, silenceDurationMs);
      };

      const onOutput = () => {
        resetSilenceTimer();
      };

      const onExit = () => {
        cleanup();
        const matched = this.buffer;
        this.buffer = '';
        resolve(matched);
      };

      this.on('output', onOutput);
      this.on('exit', onExit);

      resetSilenceTimer();

      totalTimeoutTimer = setTimeout(() => {
        cleanup();
        reject(new Error(`readUntilHeuristic timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });
  }

  // Basic stream interface
  async *readStream(): AsyncGenerator<ProcessOutput, void, unknown> {
    const queue: ProcessOutput[] = [];
    let resolveNext: (() => void) | null = null;
    let finished = false;
    let error: Error | null = null;

    const onData = (chunk: string, type: 'stdout' | 'stderr') => {
      queue.push({ type, chunk });
      if (resolveNext) {
        resolveNext();
        resolveNext = null;
      }
    };

    const onExit = (e: { error?: string }) => {
      finished = true;
      if (e.error) error = new Error(e.error);
      if (resolveNext) {
        resolveNext();
        resolveNext = null;
      }
    };

    this.on('output', onData);
    this.on('exit', onExit);

    try {
      while (!finished || queue.length > 0) {
        if (queue.length > 0) {
          yield queue.shift()!;
        } else {
          if (finished) {
            if (error) throw error;
            break;
          }
          await new Promise<void>((r) => (resolveNext = r));
        }
      }
    } finally {
      this.off('output', onData);
      this.off('exit', onExit);
    }
  }

  kill(signal: string = 'SIGTERM'): void {
    if (this.killed) return;
    this.killed = true;

    if (this.timeoutTimer) clearTimeout(this.timeoutTimer);

    if (this.isPty && this.ptyProcess) {
      try {
        this.ptyProcess.kill(signal);
      } catch {
        // ignore if already dead
      }
    } else if (this.childProcess) {
      this.childProcess.kill(signal as NodeJS.Signals);
    }
  }

  private handleOutput(chunk: string, stream: 'stdout' | 'stderr') {
    if (this.options.maxOutputSize && this.outputSize + chunk.length > this.options.maxOutputSize) {
      this.kill('SIGKILL');
      this.emit('error', new Error(`Max output size ${this.options.maxOutputSize} exceeded`));
      return;
    }

    this.outputSize += chunk.length;
    this.buffer += chunk;

    // Emit internal event for readStream and others
    this.emit('output', chunk, stream);

    if (this.logger && this.pid) {
      const event: SubprocessOutputChunked = {
        type: 'SubprocessOutputChunked',
        runId: this.runId || '',
        timestamp: new Date().toISOString(),
        schemaVersion: 1,
        payload: {
          pid: this.pid,
          stream,
          chunk,
        },
      };
      this.logger.log(event);
    }
  }

  private handleExit(code: number | null, signal: string | number | null, errorMsg?: string) {
    if (this.timeoutTimer) clearTimeout(this.timeoutTimer);
    this.killed = true;

    const durationMs = Date.now() - this.startTime;

    this.emit('exit', {
      code,
      signal,
      durationMs,
      error: errorMsg,
    });

    if (this.logger && this.pid) {
      const event: SubprocessExited = {
        type: 'SubprocessExited',
        runId: this.runId || '',
        timestamp: new Date().toISOString(),
        schemaVersion: 1,
        payload: {
          pid: this.pid,
          exitCode: code,
          signal: signal,
          durationMs,
          error: errorMsg,
        },
      };
      this.logger.log(event);
    }
  }
}
