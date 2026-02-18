import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConsoleUI } from './console';

const { promptSpy } = vi.hoisted(() => ({
  promptSpy: vi.fn(),
}));

vi.mock('inquirer', () => ({
  default: {
    prompt: promptSpy,
  },
}));

describe('ConsoleUI', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    promptSpy.mockReset();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prompts for confirmation and returns the result', async () => {
    promptSpy.mockResolvedValueOnce({ confirmed: true });

    const ui = new ConsoleUI();
    await expect(ui.confirm('Continue?')).resolves.toBe(true);

    expect(promptSpy).toHaveBeenCalledWith([
      expect.objectContaining({
        type: 'confirm',
        name: 'confirmed',
        message: 'Continue?',
        default: true,
      }),
    ]);
  });

  it('prints details and defaults to "no" when defaultNo is true', async () => {
    promptSpy.mockResolvedValueOnce({ confirmed: false });

    const ui = new ConsoleUI();
    await expect(ui.confirm('Continue?', 'details here', true)).resolves.toBe(false);

    expect(logSpy).toHaveBeenCalledWith('\n' + 'details here' + '\n');
    expect(promptSpy).toHaveBeenCalledWith([
      expect.objectContaining({
        message: 'Continue?',
        default: false,
      }),
    ]);
  });
});
