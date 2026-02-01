/**
 * Plugin SDK Version
 * Plugins declare compatibility with SDK version ranges.
 * Core validates this before loading plugins.
 */
export const SDK_VERSION = 1;

/**
 * Version range for plugin compatibility
 */
export interface SdkVersionRange {
  minVersion: number;
  maxVersion?: number;
}

/**
 * Check if a plugin's declared SDK version range is compatible with the current SDK
 */
export function isVersionCompatible(range: SdkVersionRange): boolean {
  const min = range.minVersion;
  const max = range.maxVersion ?? min;
  return SDK_VERSION >= min && SDK_VERSION <= max;
}

/**
 * Get a human-readable error message for version mismatch
 */
export function getVersionMismatchError(
  pluginName: string,
  range: SdkVersionRange,
): string {
  const expected =
    range.maxVersion && range.maxVersion !== range.minVersion
      ? `${range.minVersion}-${range.maxVersion}`
      : `${range.minVersion}`;
  return `Plugin "${pluginName}" requires SDK version ${expected}, but current SDK version is ${SDK_VERSION}. Please update the plugin or the orchestrator.`;
}
