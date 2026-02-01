import { describe, it, expect } from 'vitest';
import {
  SDK_VERSION,
  isVersionCompatible,
  getVersionMismatchError,
  validateManifest,
  PluginVersionMismatchError,
} from './index';

describe('version', () => {
  it('exports SDK_VERSION as 1', () => {
    expect(SDK_VERSION).toBe(1);
  });

  it('isVersionCompatible returns true for matching version', () => {
    expect(isVersionCompatible({ minVersion: 1 })).toBe(true);
    expect(isVersionCompatible({ minVersion: 1, maxVersion: 1 })).toBe(true);
    expect(isVersionCompatible({ minVersion: 1, maxVersion: 2 })).toBe(true);
  });

  it('isVersionCompatible returns false for incompatible version', () => {
    expect(isVersionCompatible({ minVersion: 2 })).toBe(false);
    expect(isVersionCompatible({ minVersion: 0, maxVersion: 0 })).toBe(false);
  });

  it('getVersionMismatchError returns helpful message', () => {
    const msg = getVersionMismatchError('test-plugin', { minVersion: 2 });
    expect(msg).toContain('test-plugin');
    expect(msg).toContain('2');
    expect(msg).toContain(String(SDK_VERSION));
  });
});

describe('validateManifest', () => {
  it('returns true for valid manifest', () => {
    expect(
      validateManifest({
        name: 'test-plugin',
        type: 'provider',
        sdkVersion: { minVersion: 1 },
        version: '1.0.0',
      }),
    ).toBe(true);
  });

  it('returns false for invalid manifest', () => {
    expect(validateManifest(null)).toBe(false);
    expect(validateManifest({})).toBe(false);
    expect(validateManifest({ name: 'test' })).toBe(false);
    expect(
      validateManifest({
        name: 'test',
        type: 'invalid',
        sdkVersion: { minVersion: 1 },
        version: '1.0.0',
      }),
    ).toBe(false);
  });
});

describe('PluginVersionMismatchError', () => {
  it('creates error with proper message', () => {
    const error = new PluginVersionMismatchError('my-plugin', { minVersion: 2 }, 1);
    expect(error.name).toBe('PluginVersionMismatchError');
    expect(error.pluginName).toBe('my-plugin');
    expect(error.requiredRange).toEqual({ minVersion: 2 });
    expect(error.currentVersion).toBe(1);
    expect(error.message).toContain('my-plugin');
  });
});
