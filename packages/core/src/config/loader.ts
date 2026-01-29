import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { Config, ConfigSchema } from '@orchestrator/shared';
import os from 'os';

export interface ConfigOptions {
  configPath?: string; // CLI override
  flags?: Partial<Config>; // CLI flags
  cwd?: string; // Current working directory (for repo config)
  env?: NodeJS.ProcessEnv; // Environment variables
}

export class ConfigLoader {
  static loadYaml(filePath: string): Partial<Config> {
    try {
      if (!fs.existsSync(filePath)) {
        return {};
      }
      const content = fs.readFileSync(filePath, 'utf8');
      const parsed = yaml.load(content);
      return parsed as Partial<Config>;
    } catch (error: unknown) {
      if (error instanceof yaml.YAMLException) {
        throw new Error(`Error parsing YAML file: ${filePath}\n${error.message}`);
      }
      throw error;
    }
  }

  static mergeConfigs<T extends Record<string, unknown>>(
    target: T,
    source: Partial<T>
  ): T {
    const output = { ...target };
    if (!source || Object.keys(source).length === 0) {
      return output;
    }

    for (const key in source) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        const sourceValue = source[key];
        const targetValue = output[key];

        if (
          sourceValue &&
          typeof sourceValue === 'object' &&
          !Array.isArray(sourceValue)
        ) {
          if (
            targetValue &&
            typeof targetValue === 'object' &&
            !Array.isArray(targetValue)
          ) {
            output[key] = this.mergeConfigs(
              targetValue as Record<string, unknown>,
              sourceValue as Record<string, unknown>
            ) as T[Extract<keyof T, string>];
          } else {
            output[key] = sourceValue as T[Extract<keyof T, string>];
          }
        } else {
          // Arrays and primitives replace
          output[key] = sourceValue as T[Extract<keyof T, string>];
        }
      }
    }
    return output;
  }

  static writeEffectiveConfig(config: Config, dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const filePath = path.join(dir, 'effective-config.json');
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf8');
  }

  static load(options: ConfigOptions = {}): Config {
    const cwd = options.cwd || process.cwd();
    const env = options.env || process.env;

    // 1. User config: ~/.orchestrator/config.yaml
    const userConfigPath = path.join(os.homedir(), '.orchestrator', 'config.yaml');
    const userConfig = this.loadYaml(userConfigPath);

    // 2. Repo config: <repoRoot>/.orchestrator.yaml
    const repoConfigPath = path.join(cwd, '.orchestrator.yaml');
    const repoConfig = this.loadYaml(repoConfigPath);

    // 3. Explicit --config file (if provided)
    let explicitConfig: Partial<Config> = {};
    if (options.configPath) {
      if (!fs.existsSync(options.configPath)) {
        throw new Error(`Config file not found: ${options.configPath}`);
      }
      explicitConfig = this.loadYaml(options.configPath);
    }

    // 4. CLI flags (passed as partial config)
    const flagConfig = options.flags || {};

    // Merge in order of precedence: flags > explicit > repo > user
    // We cast to Record<string, unknown> to satisfy the generic constraint of mergeConfigs
    // while maintaining type safety through ConfigSchema validation at the end.
    let mergedConfig = this.mergeConfigs<Record<string, unknown>>(
      {},
      userConfig as Record<string, unknown>
    );
    mergedConfig = this.mergeConfigs(
      mergedConfig,
      repoConfig as Record<string, unknown>
    );
    mergedConfig = this.mergeConfigs(
      mergedConfig,
      explicitConfig as Record<string, unknown>
    );
    mergedConfig = this.mergeConfigs(
      mergedConfig,
      flagConfig as Record<string, unknown>
    );

    // Defaults
    const defaults: Partial<Config> = {
      configVersion: 1,
    };
    mergedConfig = this.mergeConfigs(
      defaults as Record<string, unknown>,
      mergedConfig
    );

    // Validate
    const result = ConfigSchema.safeParse(mergedConfig);

    if (!result.success) {
      const issues = result.error.issues.map(i => `- ${i.path.join('.')}: ${i.message}`).join('\n');
      throw new Error(`Configuration validation failed:\n${issues}`);
    }

    const finalConfig = result.data;

    // Handle `api_key_env` resolution
    if (finalConfig.providers) {
        for (const providerName in finalConfig.providers) {
            const providerConfig: NonNullable<Config['providers']>[string] = finalConfig.providers[providerName];
            
            if (providerConfig.api_key_env && !providerConfig.api_key) {
                const envKey = providerConfig.api_key_env;
                if (env[envKey]) {
                    providerConfig.api_key = env[envKey];
                }
            }
        }
    }

    return finalConfig;
  }
}