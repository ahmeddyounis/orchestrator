import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProceduralMemoryImpl } from './procedural_memory';

const mockStore = {
  init: vi.fn(),
  list: vi.fn(),
  close: vi.fn(),
};

vi.mock('@orchestrator/memory', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@orchestrator/memory')>();
  return {
    ...actual,
    createMemoryStore: vi.fn(() => mockStore),
  };
});

describe('ProceduralMemoryImpl', () => {
  const repoRoot = '/repo';

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ORCHESTRATOR_ENC_KEY;
    delete process.env.CUSTOM_KEY_ENV;
  });

  afterEach(() => {
    delete process.env.ORCHESTRATOR_ENC_KEY;
    delete process.env.CUSTOM_KEY_ENV;
  });

  it('returns empty results when no memory db path is configured', async () => {
    const memory = new ProceduralMemoryImpl(
      {
        memory: { storage: { path: '' } },
      } as any,
      repoRoot,
    );

    const result = await memory.find([{ text: 'q1' }, { text: 'q2', titleContains: 'x' }], 5);
    expect(result).toEqual([[], []]);
    expect(mockStore.init).not.toHaveBeenCalled();
    expect(mockStore.close).not.toHaveBeenCalled();
  });

  it('resolves relative paths, filters by titleContains, and closes the store', async () => {
    mockStore.list.mockReturnValue([
      { title: 'alpha', content: 'x' },
      { title: 'beta', content: 'y' },
      { title: 'alpha-extra', content: 'z' },
    ]);

    process.env.CUSTOM_KEY_ENV = 'secret';

    const memory = new ProceduralMemoryImpl(
      {
        memory: { storage: { path: '.orchestrator/memory.sqlite', encryptAtRest: true } },
        security: { encryption: { keyEnv: 'CUSTOM_KEY_ENV' } },
      } as any,
      repoRoot,
    );

    const result = await memory.find([{ text: 'q1', titleContains: 'alpha' }, { text: 'q2' }], 2);

    expect(mockStore.init).toHaveBeenCalledWith({
      dbPath: '/repo/.orchestrator/memory.sqlite',
      encryption: { encryptAtRest: true, key: 'secret' },
    });
    expect(mockStore.close).toHaveBeenCalled();

    expect(result[0].map((e) => e.title)).toEqual(['alpha', 'alpha-extra']);
    expect(result[1].length).toBe(2);
  });

  it('uses absolute memory paths without joining repoRoot', async () => {
    mockStore.list.mockReturnValue([]);

    const memory = new ProceduralMemoryImpl(
      {
        memory: { storage: { path: '/abs/memory.sqlite', encryptAtRest: false } },
      } as any,
      repoRoot,
    );

    await memory.find([{ text: 'q1' }], 1);

    expect(mockStore.init).toHaveBeenCalledWith({
      dbPath: '/abs/memory.sqlite',
      encryption: { encryptAtRest: false, key: '' },
    });
    expect(mockStore.close).toHaveBeenCalled();
  });

  it('closes the store even if init throws', async () => {
    mockStore.init.mockImplementationOnce(() => {
      throw new Error('init failed');
    });

    const memory = new ProceduralMemoryImpl(
      {
        memory: { storage: { path: '/abs/memory.sqlite', encryptAtRest: false } },
      } as any,
      repoRoot,
    );

    await expect(memory.find([{ text: 'q1' }], 1)).rejects.toThrow('init failed');
    expect(mockStore.close).toHaveBeenCalled();
  });
});
