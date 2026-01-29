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

export interface SubprocessConfig {
  command: string[];
  cwdMode?: 'repoRoot' | 'runDir';
  env?: string[]; // Allowlist of env vars to pass through
}

export class SubprocessProviderAdapter implements ProviderAdapter {
  constructor(private config: SubprocessConfig) {}

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

  async generate(req: ModelRequest, ctx: AdapterContext): Promise<ModelResponse> {
    const pm = new ProcessManager({
      logger: ctx.logger,
      runId: ctx.runId,
      timeoutMs: ctx.timeoutMs,
    });

    const cwd = process.cwd(); // Default to process.cwd() for 'repoRoot' and 'runDir' for MVP

    // Env construction
    const env: Record<string, string> = {};
    const shouldInherit = !this.config.env;

    if (this.config.env) {
      for (const key of this.config.env) {
        if (process.env[key] !== undefined) {
          env[key] = process.env[key]!;
        }
      }
    }

    // Logging setup
    // Ensure we don't crash if artifacts dir setup fails or isn't there (though it should be)
    let logPath: string | undefined;
    try {
      const artifacts = getRunArtifactPaths(process.cwd(), ctx.runId);
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

    // Capture output
    let outputText = '';
    pm.on('output', async (chunk) => {
      outputText += chunk;
      await logTranscript(chunk);
    });

    try {
      await pm.spawn(this.config.command, cwd, env, false, shouldInherit);

      // Render prompt
      const prompt = req.messages
        .filter((m) => m.role === 'system' || m.role === 'user')
        .map((m) => m.content)
        .join('\n');

      // Send input
      // Send input with newline to ensure it's processed
      const input = prompt + '\n';
      // Log input as well? Spec says "raw transcripts". Usually includes input.
      // But process manager 'output' event only covers stdout/stderr.
      // We manually log stdin.
      await logTranscript(input);
      pm.write(input);

      // Wait for termination
      // Heuristic: 800ms silence AND prompt marker appears
      await pm.readUntilHeuristic(800, (text) => {
        const trimmed = text.trim();
        // Check for common prompt markers
        return (
          trimmed.endsWith('>') ||
          trimmed.endsWith('$') ||
          trimmed.endsWith('#') ||
          trimmed.endsWith('%')
        );
      });
    } catch (e) {
      const err = e as Error;
      if (err.message && err.message.includes('timed out')) {
        // Normalize TimeoutError
        throw new Error(`TimeoutError: ${err.message}`);
      }
      throw new Error(`ProcessError: ${err.message}`);
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
