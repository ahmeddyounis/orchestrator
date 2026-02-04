import { Config, ToolPolicy } from '@orchestrator/shared';
import { UserInterface } from '@orchestrator/exec';
import { EventBus } from '../../registry';
import { VerificationRunner } from '../../verify/runner';
import { VerificationProfile, VerificationReport } from '../../verify/types';
import { ProceduralMemoryImpl } from '../procedural_memory';

/**
 * Service for managing verification operations
 */
export class VerificationService {
  private runner: VerificationRunner;
  private profile: VerificationProfile;

  constructor(
    config: Config,
    repoRoot: string,
    toolPolicy: ToolPolicy,
    ui: UserInterface,
    eventBus: EventBus,
  ) {
    const proceduralMemory = new ProceduralMemoryImpl(config, repoRoot);
    this.runner = new VerificationRunner(proceduralMemory, toolPolicy, ui, eventBus, repoRoot);

    this.profile = {
      enabled: config.verification?.enabled ?? true,
      mode: config.verification?.mode || 'auto',
      steps: [],
      auto: {
        enableLint: config.verification?.auto?.enableLint ?? true,
        enableTypecheck: config.verification?.auto?.enableTypecheck ?? true,
        enableTests: config.verification?.auto?.enableTests ?? true,
        testScope: config.verification?.auto?.testScope || 'targeted',
        maxCommandsPerIteration: config.verification?.auto?.maxCommandsPerIteration ?? 5,
      },
    };
  }

  /**
   * Run verification with the configured profile
   */
  async verify(
    touchedFiles: string[],
    runId: string,
  ): Promise<VerificationReport> {
    return this.runner.run(
      this.profile,
      this.profile.mode,
      { touchedFiles },
      { runId },
    );
  }

  /**
   * Get the verification profile
   */
  getProfile(): VerificationProfile {
    return this.profile;
  }

  /**
   * Get the underlying runner for advanced usage
   */
  getRunner(): VerificationRunner {
    return this.runner;
  }

  /**
   * Check if verification is enabled
   */
  isEnabled(): boolean {
    return this.profile.enabled;
  }
}
