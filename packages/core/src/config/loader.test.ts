import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConfigLoader } from './loader';
import fs from 'fs';
import path from 'path';
import os from 'os';
import yaml from 'js-yaml';
import { Config } from '@orchestrator/shared';

vi.mock('fs');
vi.mock('os');

describe('ConfigLoader', () => {
  const mockHome = '/mock/home';
  const mockCwd = '/mock/cwd';

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(os.homedir).mockReturnValue(mockHome);
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.readFileSync).mockReturnValue('');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('load', () => {
    it('should load default config when no files exist', () => {
      const config = ConfigLoader.load({ cwd: mockCwd });
      expect(config).toEqual({ configVersion: 1 });
    });

    it('should load user config', () => {
      const userConfig = { budgets: { gpt4: 100 } };
      vi.mocked(fs.existsSync).mockImplementation(
        (p) => p === path.join(mockHome, '.orchestrator', 'config.yaml'),
      );
      vi.mocked(fs.readFileSync).mockImplementation((p) => {
        if (p === path.join(mockHome, '.orchestrator', 'config.yaml')) return yaml.dump(userConfig);
        return '';
      });

      const config = ConfigLoader.load({ cwd: mockCwd });
      expect(config.budgets).toEqual({ gpt4: 100 });
    });

    it('should respect precedence: flags > explicit > repo > user', () => {
      const userConfig = { budgets: { test: 1 } };
      const repoConfig = { budgets: { test: 2 } };
      const explicitConfig = { budgets: { test: 3 } };
      const flags = { budgets: { test: 4 } };

      vi.mocked(fs.existsSync).mockImplementation((p) => {
        if (p === path.join(mockHome, '.orchestrator', 'config.yaml')) return true;
        if (p === path.join(mockCwd, '.orchestrator.yaml')) return true;
        if (p === '/explicit/config.yaml') return true;
        return false;
      });

      vi.mocked(fs.readFileSync).mockImplementation((p) => {
        if (p === path.join(mockHome, '.orchestrator', 'config.yaml')) return yaml.dump(userConfig);
        if (p === path.join(mockCwd, '.orchestrator.yaml')) return yaml.dump(repoConfig);
        if (p === '/explicit/config.yaml') return yaml.dump(explicitConfig);
        return '';
      });

      const config = ConfigLoader.load({
        cwd: mockCwd,
        configPath: '/explicit/config.yaml',
        flags: flags as Partial<Config>,
      });

      expect(config.budgets?.test).toBe(4);
    });

    it('should fail if explicit config file is missing', () => {
      expect(() => ConfigLoader.load({ configPath: '/missing.yaml' })).toThrow(
        /Config file not found/,
      );
    });

    it('should fail on invalid YAML', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('invalid: yaml: :');

      expect(() => ConfigLoader.load({ configPath: '/invalid.yaml' })).toThrow(
        /Error parsing YAML file/,
      );
    });

    it('should fail on schema validation', () => {
      const invalidConfig = { budgets: { test: 'not a number' } };
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(yaml.dump(invalidConfig));

      expect(() => ConfigLoader.load({ configPath: '/config.yaml' })).toThrow(
        /Configuration validation failed/,
      );
    });

    it('should resolve api_key_env', () => {
      const env = { MY_API_KEY: 'secret-key' };
      const configWithEnv = {
        providers: {
          openai: {
            type: 'openai',
            model: 'gpt-4',
            api_key_env: 'MY_API_KEY',
          },
        },
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(yaml.dump(configWithEnv));

      const config = ConfigLoader.load({
        configPath: '/config.yaml',
        env: env as NodeJS.ProcessEnv,
      });
      expect(config.providers?.openai.api_key).toBe('secret-key');
    });
  });

  describe('writeEffectiveConfig', () => {
    it('should write config to json file', () => {
      const config = { configVersion: 1 } as Config;
      const dir = '/run/dir';

      ConfigLoader.writeEffectiveConfig(config, dir);

      expect(fs.mkdirSync).toHaveBeenCalledWith(dir, { recursive: true });
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        path.join(dir, 'effective-config.json'),
        JSON.stringify(config, null, 2),
        'utf8',
      );
    });
  });
});
