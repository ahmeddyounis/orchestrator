import { ProviderAdapter } from '../adapter';
import { ModelRequest, ModelResponse, ProviderCapabilities } from '@orchestrator/shared';
import { AdapterContext } from '../types';
export interface SubprocessConfig {
  command: string[];
  cwdMode?: 'repoRoot' | 'runDir';
  env?: string[];
}
export declare class SubprocessProviderAdapter implements ProviderAdapter {
  private config;
  constructor(config: SubprocessConfig);
  id(): string;
  capabilities(): ProviderCapabilities;
  /**
   * Detects if a chunk of text from a subprocess indicates it is idle and waiting for a prompt.
   * Subclasses can override this to provide more specific detection logic.
   * @param text The text to inspect.
   * @returns True if the text is a prompt marker.
   */
  protected isPrompt(text: string): boolean;
  generate(req: ModelRequest, ctx: AdapterContext): Promise<ModelResponse>;
}
//# sourceMappingURL=adapter.d.ts.map
