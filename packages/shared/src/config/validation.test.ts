import { describe, it, expect } from 'vitest';
import { validateProviderConfig, formatValidationResult } from './validation';
import type { ProviderCapabilities } from '../types/llm';
import type { ProviderConfig } from './schema';

describe('validateProviderConfig', () => {
  const baseConfig: ProviderConfig = {
    type: 'openai',
    model: 'gpt-4',
  };

  const baseCapabilities: ProviderCapabilities = {
    supportsStreaming: true,
    supportsToolCalling: true,
    supportsJsonMode: true,
    modality: 'text',
    latencyClass: 'medium',
  };

  describe('basic validation', () => {
    it('should pass for valid config with no requirements', () => {
      const result = validateProviderConfig(baseConfig, baseCapabilities, 'test-provider');

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail when model is missing', () => {
      const config: ProviderConfig = { type: 'openai', model: '' };
      const result = validateProviderConfig(config, baseCapabilities, 'test-provider');

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'model',
          code: 'MISSING_REQUIRED',
        }),
      );
    });
  });

  describe('API key requirements', () => {
    const capsWithApiKeyReq: ProviderCapabilities = {
      ...baseCapabilities,
      configRequirements: {
        requiresApiKey: true,
      },
    };

    it('should fail when API key is required but not provided', () => {
      const result = validateProviderConfig(baseConfig, capsWithApiKeyReq, 'test-provider');

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'api_key',
          code: 'MISSING_REQUIRED',
        }),
      );
    });

    it('should pass when api_key is provided', () => {
      const config: ProviderConfig = { ...baseConfig, api_key: 'sk-test' };
      const result = validateProviderConfig(config, capsWithApiKeyReq, 'test-provider');

      expect(result.valid).toBe(true);
    });

    it('should pass when api_key_env is provided', () => {
      const config: ProviderConfig = { ...baseConfig, api_key_env: 'OPENAI_API_KEY' };
      const result = validateProviderConfig(config, capsWithApiKeyReq, 'test-provider');

      expect(result.valid).toBe(true);
    });
  });

  describe('command requirements', () => {
    const capsWithCommandReq: ProviderCapabilities = {
      ...baseCapabilities,
      configRequirements: {
        requiresCommand: true,
      },
    };

    it('should fail when command is required but not provided', () => {
      const result = validateProviderConfig(baseConfig, capsWithCommandReq, 'test-provider');

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'command',
          code: 'MISSING_REQUIRED',
        }),
      );
    });

    it('should pass when command is provided', () => {
      const config: ProviderConfig = { ...baseConfig, command: '/usr/local/bin/claude' };
      const result = validateProviderConfig(config, capsWithCommandReq, 'test-provider');

      expect(result.valid).toBe(true);
    });
  });

  describe('forbidden args', () => {
    const capsWithForbiddenArgs: ProviderCapabilities = {
      ...baseCapabilities,
      configRequirements: {
        forbiddenArgs: ['--json', '-m', '--model'],
      },
    };

    it('should fail when forbidden args are present', () => {
      const config: ProviderConfig = { ...baseConfig, args: ['--verbose', '--json', '-m'] };
      const result = validateProviderConfig(config, capsWithForbiddenArgs, 'test-provider');

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(2);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'args',
          code: 'FORBIDDEN_FIELD',
          message: expect.stringContaining('--json'),
        }),
      );
    });

    it('should pass when no forbidden args are present', () => {
      const config: ProviderConfig = { ...baseConfig, args: ['--verbose', '--color', 'auto'] };
      const result = validateProviderConfig(config, capsWithForbiddenArgs, 'test-provider');

      expect(result.valid).toBe(true);
    });
  });

  describe('capability compatibility warnings', () => {
    it('should warn when supportsTools is set but adapter does not support tool calling', () => {
      const capsNoTools: ProviderCapabilities = {
        ...baseCapabilities,
        supportsToolCalling: false,
      };
      const config: ProviderConfig = { ...baseConfig, supportsTools: true };
      const result = validateProviderConfig(config, capsNoTools, 'test-provider');

      expect(result.valid).toBe(true);
      expect(result.warnings).toContainEqual(
        expect.objectContaining({
          field: 'supportsTools',
          code: 'CAPABILITY_MISMATCH',
        }),
      );
    });

    it('should not warn when supportsTools matches adapter capability', () => {
      const config: ProviderConfig = { ...baseConfig, supportsTools: true };
      const result = validateProviderConfig(config, baseCapabilities, 'test-provider');

      expect(result.warnings).not.toContainEqual(
        expect.objectContaining({ code: 'CAPABILITY_MISMATCH' }),
      );
    });
  });

  describe('unknown field detection', () => {
    it('should warn about unknown config fields', () => {
      const config = {
        ...baseConfig,
        unknownField: 'value',
        anotherUnknown: 123,
      } as ProviderConfig;
      const result = validateProviderConfig(config, baseCapabilities, 'test-provider');

      expect(result.valid).toBe(true);
      expect(result.warnings).toContainEqual(
        expect.objectContaining({
          field: 'unknownField',
          code: 'UNKNOWN_FIELD',
        }),
      );
    });

    it('should not warn about adapter-specific supported fields', () => {
      const capsWithSupportedFields: ProviderCapabilities = {
        ...baseCapabilities,
        configRequirements: {
          supportedFields: {
            customOption: { description: 'A custom option', type: 'string' },
          },
        },
      };
      const config = { ...baseConfig, customOption: 'value' } as ProviderConfig;
      const result = validateProviderConfig(config, capsWithSupportedFields, 'test-provider');

      expect(result.warnings).not.toContainEqual(
        expect.objectContaining({ field: 'customOption' }),
      );
    });
  });
});

describe('formatValidationResult', () => {
  it('should format errors and warnings', () => {
    const result = formatValidationResult({
      valid: false,
      errors: [{ field: 'model', message: 'Model is required', code: 'MISSING_REQUIRED' }],
      warnings: [{ field: 'unknownField', message: 'Unknown field', code: 'UNKNOWN_FIELD' }],
    });

    expect(result).toContain('Configuration errors:');
    expect(result).toContain('[model] Model is required');
    expect(result).toContain('Configuration warnings:');
    expect(result).toContain('[unknownField] Unknown field');
  });
});
