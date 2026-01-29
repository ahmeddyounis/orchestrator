import { describe, it, expect, vi, beforeEach } from 'vitest';
import { confirm } from './confirm';
import inquirer from 'inquirer';

vi.mock('inquirer', () => ({
  default: {
    prompt: vi.fn(),
  },
}));

describe('confirm utility', () => {
  const mockLogger = { log: vi.fn() };
  const runId = 'test-run';

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset TTY to true by default for tests, can override
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
  });

  it('should return true when yes flag is set', async () => {
    const result = await confirm('Action', undefined, true, {
      yes: true,
      logger: mockLogger,
      runId,
    });
    expect(result).toBe(true);
    expect(inquirer.prompt).not.toHaveBeenCalled();
    // Should log resolved
    expect(mockLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ConfirmationResolved',
        payload: expect.objectContaining({ approved: true, autoResolved: true }),
      }),
    );
  });

  it('should return false when nonInteractive flag is set', async () => {
    const result = await confirm('Action', undefined, true, {
      nonInteractive: true,
      logger: mockLogger,
      runId,
    });
    expect(result).toBe(false);
    expect(inquirer.prompt).not.toHaveBeenCalled();
    expect(mockLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ConfirmationResolved',
        payload: expect.objectContaining({ approved: false, autoResolved: true }),
      }),
    );
  });

  it('should prompt when interactive and return user selection (true)', async () => {
    vi.mocked(inquirer.prompt).mockResolvedValueOnce({ confirmed: true });

    const result = await confirm('Action', 'Details', true, { logger: mockLogger, runId });

    expect(result).toBe(true);
    expect(inquirer.prompt).toHaveBeenCalled();
    expect(mockLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ConfirmationRequested' }),
    );
    expect(mockLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ConfirmationResolved',
        payload: expect.objectContaining({ approved: true, autoResolved: false }),
      }),
    );
  });

  it('should prompt when interactive and return user selection (false)', async () => {
    vi.mocked(inquirer.prompt).mockResolvedValueOnce({ confirmed: false });

    const result = await confirm('Action', undefined, true, { logger: mockLogger, runId });

    expect(result).toBe(false);
  });

  it('should return false if not TTY (simulating non-interactive env)', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });

    const result = await confirm('Action', undefined, true, { logger: mockLogger, runId });
    expect(result).toBe(false);
    expect(inquirer.prompt).not.toHaveBeenCalled();
    // Should log auto-denial
    expect(mockLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ConfirmationResolved',
        payload: expect.objectContaining({ approved: false, autoResolved: true }),
      }),
    );
  });
});
