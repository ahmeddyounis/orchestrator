import { ConfigError, ProviderConfig } from '@orchestrator/shared';
import type { ProviderAdapter } from './adapter';
import { OpenAIAdapter } from './openai';
import { AnthropicAdapter } from './anthropic';
import { ClaudeCodeAdapter } from './claude_code';
import { GeminiCliAdapter } from './gemini_cli';
import { CodexCliAdapter } from './codex_cli';
import { FakeAdapter } from './fake/adapter';
import { SubprocessProviderAdapter } from './subprocess';

export type ProviderFactoryRegistry = {
  registerFactory(type: string, factory: (cfg: ProviderConfig) => ProviderAdapter): void;
};

export type BuiltInProviderFactoryOptions = {
  includeFake?: boolean;
  includeSubprocess?: boolean;
};

export function registerBuiltInProviderFactories(
  registry: ProviderFactoryRegistry,
  options: BuiltInProviderFactoryOptions = {},
): void {
  registry.registerFactory('openai', (cfg) => new OpenAIAdapter(cfg));
  registry.registerFactory('anthropic', (cfg) => new AnthropicAdapter(cfg));
  registry.registerFactory('claude_code', (cfg) => new ClaudeCodeAdapter(cfg));
  registry.registerFactory('gemini_cli', (cfg) => new GeminiCliAdapter(cfg));
  registry.registerFactory('codex_cli', (cfg) => new CodexCliAdapter(cfg));

  if (options.includeFake) {
    registry.registerFactory('fake', (cfg) => new FakeAdapter(cfg));
  }

  if (options.includeSubprocess) {
    registry.registerFactory('subprocess', (cfg) => {
      if (!cfg.command) {
        throw new ConfigError(`Provider type 'subprocess' requires 'command' in config.`);
      }

      return new SubprocessProviderAdapter({
        command: [cfg.command, ...(cfg.args ?? [])],
        cwdMode: cfg.cwdMode,
        envAllowlist: cfg.env,
        timeoutMs: cfg.timeoutMs,
        pty: cfg.pty,
      });
    });
  }
}
