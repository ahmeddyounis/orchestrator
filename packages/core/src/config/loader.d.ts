import { Config, OrchestratorConfig } from '@orchestrator/shared';
export interface ConfigOptions {
  configPath?: string;
  flags?: Partial<Config>;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}
export type LoadedConfig = OrchestratorConfig & {
  configPath: string | undefined;
  effective: OrchestratorConfig;
};
export declare function getOrchestratorConfig(
  configPath?: string,
  flags?: Partial<Config>,
): Promise<LoadedConfig>;
export declare class ConfigLoader {
  static loadYaml(filePath: string): Partial<Config>;
  static mergeConfigs<T extends Record<string, unknown>>(target: T, source: Partial<T>): T;
  static writeEffectiveConfig(config: Config, dir: string): void;
  private static applyThinkLevelDefaults;
  static load(options?: ConfigOptions): Config;
}
//# sourceMappingURL=loader.d.ts.map
