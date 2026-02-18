import { describe, it, expect, vi } from 'vitest';
import { VerificationService } from './verification-service';

describe('VerificationService', () => {
  it('defaults to an enabled auto profile', () => {
    const service = new VerificationService(
      {} as any,
      '/repo',
      {} as any,
      {} as any,
      { emit: vi.fn() } as any,
    );

    expect(service.isEnabled()).toBe(true);
    expect(service.getProfile()).toEqual({
      enabled: true,
      mode: 'auto',
      steps: [],
      auto: {
        enableLint: true,
        enableTypecheck: true,
        enableTests: true,
        testScope: 'targeted',
        maxCommandsPerIteration: 5,
      },
    });
  });

  it('respects verification config overrides', () => {
    const service = new VerificationService(
      {
        verification: {
          enabled: false,
          mode: 'custom',
          auto: {
            enableLint: false,
            enableTypecheck: false,
            enableTests: false,
            testScope: 'full',
            maxCommandsPerIteration: 1,
          },
        },
      } as any,
      '/repo',
      {} as any,
      {} as any,
      { emit: vi.fn() } as any,
    );

    expect(service.isEnabled()).toBe(false);
    expect(service.getProfile()).toEqual({
      enabled: false,
      mode: 'custom',
      steps: [],
      auto: {
        enableLint: false,
        enableTypecheck: false,
        enableTests: false,
        testScope: 'full',
        maxCommandsPerIteration: 1,
      },
    });
  });
});

