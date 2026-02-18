import { ConsoleLogger } from './consoleLogger';
import type { RunStarted } from '../types/events';

describe('ConsoleLogger', () => {
  it('logs and traces events as JSON', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const logger = new ConsoleLogger();
    const event: RunStarted = {
      schemaVersion: 1,
      timestamp: '2026-02-18T00:00:00.000Z',
      runId: 'run-1',
      type: 'RunStarted',
      payload: { taskId: 't1', goal: 'test' },
    };

    logger.log(event);
    expect(logSpy).toHaveBeenCalledWith(JSON.stringify(event));

    logger.trace(event, 'hello');
    expect(logSpy).toHaveBeenCalledWith('hello', JSON.stringify(event));

    logSpy.mockRestore();
  });

  it('writes debug/info/warn and handles error branches', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const logger = new ConsoleLogger();

    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error(new Error('boom'));
    logger.error(new Error('boom'), 'msg');

    expect(debugSpy).toHaveBeenCalledWith('d');
    expect(infoSpy).toHaveBeenCalledWith('i');
    expect(warnSpy).toHaveBeenCalledWith('w');
    expect(errorSpy).toHaveBeenCalledWith(expect.any(Error));
    expect(errorSpy).toHaveBeenCalledWith('msg', expect.any(Error));

    debugSpy.mockRestore();
    infoSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('scopes child loggers with prefixes and merges bindings', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const logger = new ConsoleLogger();
    logger.child({}).info('no-prefix');
    expect(infoSpy).toHaveBeenCalledWith('no-prefix');

    logger.child({ a: 1 }).child({ b: 'x' }).info('hello');
    expect(infoSpy).toHaveBeenCalledWith('[a=1 b=x] hello');

    logger.child({ env: 'dev' }).warn('warn');
    expect(warnSpy).toHaveBeenCalledWith('[env=dev] warn');

    infoSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
