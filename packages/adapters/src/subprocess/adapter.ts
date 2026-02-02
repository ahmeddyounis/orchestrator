import { ProcessError, TimeoutError } from '../errors';
import { ProviderAdapter } from '../adapter';
import { ProcessManager } from './process-manager';
import {
  ModelRequest,
  ModelResponse,
  ProviderCapabilities,
  getRunArtifactPaths,
} from '@orchestrator/shared';
import { AdapterContext } from '../types';
import * as path from 'path';
import * as fs from 'fs/promises';
import {
  CompatibilityProfile,
  DefaultCompatibilityProfile,
  SubprocessCompatibilityProfiles,
} from './compatibility';

export interface SubprocessConfig {
  command: string[];
  cwdMode?: 'repoRoot' | 'runDir';
  envAllowlist?: string[]; // Allowlist of env vars to pass through
  maxTranscriptSize?: number;
  compatibilityProfile?: keyof typeof SubprocessCompatibilityProfiles;
  /**
   * If true, spawn the subprocess inside a pseudo-terminal (PTY).
   * Some interactive CLIs (e.g. Claude Code) require a TTY to function correctly.
   */
  pty?: boolean;
}

export class SubprocessProviderAdapter implements ProviderAdapter {
  private compatibilityProfile: CompatibilityProfile;

  constructor(private config: SubprocessConfig) {
    this.compatibilityProfile =
      (config.compatibilityProfile &&
        SubprocessCompatibilityProfiles[config.compatibilityProfile]) ||
      DefaultCompatibilityProfile;
  }

  id(): string {
    return 'subprocess';
  }

  capabilities(): ProviderCapabilities {
    return {
      supportsStreaming: false,
      supportsToolCalling: false,
      supportsJsonMode: false,
      modality: 'text',
      latencyClass: 'slow',
    };
  }

  /**
   * Detects if a chunk of text from a subprocess indicates it is idle and waiting for a prompt.
   * @param text The text to inspect.
   * @returns True if the text is a prompt marker.
   */
  protected isPrompt(text: string): boolean {
    return this.compatibilityProfile.promptDetectionPattern.test(text);
  }

  async generate(req: ModelRequest, ctx: AdapterContext): Promise<ModelResponse> {
    const pm = new ProcessManager({
      logger: ctx.logger,
      runId: ctx.runId,
      timeoutMs: ctx.timeoutMs,
      envAllowlist: this.config.envAllowlist,
    });

    const repoRoot = ctx.repoRoot ?? process.cwd();
    const cwd = this.config.cwdMode === 'repoRoot' ? repoRoot : process.cwd(); // Default to process.cwd() for MVP

    // Env construction is now handled by ProcessManager based on envAllowlist
    const env: Record<string, string> = {};

    // Logging setup
    // Ensure we don't crash if artifacts dir setup fails or isn't there (though it should be)
    let logPath: string | undefined;
    try {
      const artifacts = getRunArtifactPaths(repoRoot, ctx.runId);
      logPath = path.join(artifacts.toolLogsDir, `subprocess_${this.id()}.log`);
    } catch {
      // Ignore if can't resolve paths
    }

    const logTranscript = async (chunk: string) => {
      if (logPath) {
        try {
          await fs.appendFile(logPath, chunk);
        } catch {
          // Ignore logging errors
        }
      }
    };

    // Ensure the transcript file exists even if the subprocess produces no output
    // (helps debugging startup hangs/timeouts).
    await logTranscript('');

    // Capture output
    let outputText = '';
    // Default to a sane limit (e.g., 16MB) to prevent memory exhaustion
    const maxTranscriptSize = this.config.maxTranscriptSize || 16 * 1024 * 1024;
    const truncationMarker = `\n\n...[TRUNCATED. Showing last ${maxTranscriptSize} bytes]...\n\n`;

    pm.on('output', async (chunk) => {
      outputText += chunk;
      // If we've exceeded the budget, trim from the beginning
      if (outputText.length > maxTranscriptSize) {
        outputText =
          truncationMarker +
          outputText.slice(outputText.length - (maxTranscriptSize - truncationMarker.length));
      }
      await logTranscript(chunk);
    });

    let timedOut = false;
    pm.on('timeout', () => {
      timedOut = true;
    });

    const isPrompt = (text: string) => this.isPrompt(text);

    try {
      await pm.spawn(this.config.command, cwd, env, this.config.pty ?? false);

      // Consume initial prompt
      await pm.readUntilHeuristic(this.compatibilityProfile.initialPromptTimeoutMs, isPrompt);

      // Render prompt
      const prompt = req.messages
        .filter((m) => m.role === 'system' || m.role === 'user')
        .map((m) => m.content)
        .join('\n');

      const shouldSendInput = prompt.trim().length > 0;

      // Only clear outputText if we're going to send input to an interactive process.
      // Some non-interactive commands may print a "prompt-looking" marker right before exiting;
      // give them a brief window to exit before treating them as interactive.
      if (shouldSendInput && pm.isRunning) {
        await new Promise((r) => setTimeout(r, 100));
        if (pm.isRunning) {
          outputText = '';
        }
      }

      // Send input (only if we have something to send and the process is still running).
      if (shouldSendInput && pm.isRunning) {
        // Send input with newline to ensure it's processed.
        const input = prompt + '\n';
        // Log stdin for "raw transcripts".
        await logTranscript(input);
        pm.write(input);

        // Wait for termination.
        if (pm.isRunning) {
          await pm.readUntilHeuristic(
            this.compatibilityProfile.promptInactivityTimeoutMs,
            isPrompt,
          );
        }
      }

      if (timedOut) {
        throw new TimeoutError('Process timed out');
      }

      // Strip trailing prompt marker (if present) from the transcript.
      outputText = outputText.trimEnd();
      const lines = outputText.split('\n');
      while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
        lines.pop();
      }

      const lastLine = lines.length > 0 ? lines[lines.length - 1] : '';
      if (lastLine && this.isPrompt(lastLine)) {
        lines.pop();
        while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
          lines.pop();
        }
        outputText = lines.join('\n').trimEnd();
      } else {
        outputText = outputText.trim();
      }
    } catch (e) {
      const err = e as Error;
      if (err instanceof TimeoutError) {
        throw err;
      }
      throw new ProcessError(`Subprocess execution failed: ${err.message}`);
    } finally {
      pm.kill();
    }

    return {
      text: outputText,
      usage: {
        inputTokens: outputText.length, // Placeholder
        outputTokens: outputText.length,
      },
    };
  }
}
