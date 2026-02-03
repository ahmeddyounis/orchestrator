import type {
  ProviderCapabilities,
  AdapterConfigRequirements,
  ConfigValidationResult,
  ConfigValidationError,
  ConfigValidationWarning,
} from '../types/llm';
import type { ProviderConfig } from './schema';

/**
 * Known config fields in ProviderConfig schema.
 * Used to detect unknown fields that might be typos or unsupported options.
 */
const KNOWN_PROVIDER_CONFIG_FIELDS = new Set([
  'type',
  'model',
  'ossMode',
  'supportsTools',
  'api_key_env',
  'api_key',
  'command',
  'args',
  'env',
  'cwdMode',
  'timeoutMs',
  'pricing',
  'pty',
]);

/**
 * Validates a provider configuration against adapter capabilities and requirements.
 *
 * This function performs runtime validation to catch configuration errors early,
 * before adapter instantiation fails with cryptic errors.
 *
 * @param config - The provider configuration to validate
 * @param capabilities - The adapter's declared capabilities (including configRequirements)
 * @param providerId - The provider ID for error messages
 * @returns Validation result with errors and warnings
 */
export function validateProviderConfig(
  config: ProviderConfig,
  capabilities: ProviderCapabilities,
  providerId: string,
): ConfigValidationResult {
  const errors: ConfigValidationError[] = [];
  const warnings: ConfigValidationWarning[] = [];
  const requirements = capabilities.configRequirements;

  // Always validate model is present
  if (!config.model) {
    errors.push({
      field: 'model',
      message: `Provider '${providerId}' requires a model to be specified`,
      code: 'MISSING_REQUIRED',
    });
  }

  // Validate against adapter requirements if provided
  if (requirements) {
    // Check API key requirement
    if (requirements.requiresApiKey) {
      const hasApiKey = config.api_key || config.api_key_env;
      if (!hasApiKey) {
        errors.push({
          field: 'api_key',
          message: `Provider '${providerId}' requires an API key (set api_key or api_key_env)`,
          code: 'MISSING_REQUIRED',
        });
      }
    }

    // Check command requirement
    if (requirements.requiresCommand && !config.command) {
      errors.push({
        field: 'command',
        message: `Provider '${providerId}' requires a command path to be specified`,
        code: 'MISSING_REQUIRED',
      });
    }

    // Check required fields
    if (requirements.requiredFields) {
      for (const field of requirements.requiredFields) {
        if (!(field in config) || config[field as keyof ProviderConfig] === undefined) {
          errors.push({
            field,
            message: `Provider '${providerId}' requires field '${field}'`,
            code: 'MISSING_REQUIRED',
          });
        }
      }
    }

    // Check forbidden args
    if (requirements.forbiddenArgs && config.args) {
      for (const arg of config.args) {
        if (requirements.forbiddenArgs.includes(arg)) {
          errors.push({
            field: 'args',
            message: `Provider '${providerId}' manages '${arg}' internally; remove it from config.args`,
            code: 'FORBIDDEN_FIELD',
          });
        }
      }
    }
  }

  // Validate capability-config compatibility
  validateCapabilityCompatibility(config, capabilities, providerId, errors, warnings);

  // Check for unknown fields (potential typos)
  detectUnknownFields(config, requirements, providerId, warnings);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validates that config options are compatible with adapter capabilities.
 */
function validateCapabilityCompatibility(
  config: ProviderConfig,
  capabilities: ProviderCapabilities,
  providerId: string,
  errors: ConfigValidationError[],
  warnings: ConfigValidationWarning[],
): void {
  // Warn if supportsTools is set but adapter doesn't support tool calling
  if (config.supportsTools === true && !capabilities.supportsToolCalling) {
    warnings.push({
      field: 'supportsTools',
      message: `Provider '${providerId}' has supportsTools=true but the adapter does not support tool calling`,
      code: 'CAPABILITY_MISMATCH',
    });
  }

  // Warn if pricing is set but adapter doesn't have pricing info
  if (config.pricing && !capabilities.pricing) {
    warnings.push({
      field: 'pricing',
      message: `Provider '${providerId}' has custom pricing set; this will override adapter defaults`,
      code: 'CAPABILITY_MISMATCH',
    });
  }
}

/**
 * Detects unknown config fields that might be typos or unsupported options.
 */
function detectUnknownFields(
  config: ProviderConfig,
  requirements: AdapterConfigRequirements | undefined,
  providerId: string,
  warnings: ConfigValidationWarning[],
): void {
  const knownFields = new Set(KNOWN_PROVIDER_CONFIG_FIELDS);

  // Add adapter-specific supported fields
  if (requirements?.supportedFields) {
    for (const field of Object.keys(requirements.supportedFields)) {
      knownFields.add(field);
    }
  }

  for (const field of Object.keys(config)) {
    if (!knownFields.has(field)) {
      warnings.push({
        field,
        message: `Provider '${providerId}' has unknown config field '${field}'; this may be a typo or unsupported option`,
        code: 'UNKNOWN_FIELD',
      });
    }
  }
}

/**
 * Formats validation errors and warnings into a human-readable string.
 */
export function formatValidationResult(result: ConfigValidationResult): string {
  const lines: string[] = [];

  if (result.errors.length > 0) {
    lines.push('Configuration errors:');
    for (const error of result.errors) {
      lines.push(`  - [${error.field}] ${error.message}`);
    }
  }

  if (result.warnings.length > 0) {
    lines.push('Configuration warnings:');
    for (const warning of result.warnings) {
      lines.push(`  - [${warning.field}] ${warning.message}`);
    }
  }

  return lines.join('\n');
}
