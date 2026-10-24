import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger } from '../logger.js';

describe('logger', () => {
  const originalLevel = process.env.LOG_LEVEL;
  let stdout: ReturnType<typeof vi.spyOn>;
  let stderr: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    delete process.env.LOG_LEVEL;
    stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalLevel === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = originalLevel;
  });

  it('writes one JSON object per line with level, msg and fields', () => {
    logger.info('hello', { port: 4000 });

    const line = stdout.mock.calls[0][0] as string;
    expect(line.endsWith('\n')).toBe(true);
    expect(JSON.parse(line)).toMatchObject({ level: 'info', msg: 'hello', port: 4000 });
    expect(typeof JSON.parse(line).time).toBe('string');
  });

  it('sends warn and error to stderr and info to stdout', () => {
    logger.info('info line');
    logger.warn('warn line');
    logger.error('error line');

    expect(stdout).toHaveBeenCalledOnce();
    expect(stderr).toHaveBeenCalledTimes(2);
  });

  it('includes child bindings such as component on every line', () => {
    logger.child({ component: 'crank' }).info('tick');

    expect(JSON.parse(stdout.mock.calls[0][0] as string)).toMatchObject({
      component: 'crank',
      msg: 'tick',
    });
  });

  it('serialises Error objects and BigInt values', () => {
    logger.error('boom', { err: new Error('bad'), positionId: 5n });

    const parsed = JSON.parse(stderr.mock.calls[0][0] as string);
    expect(parsed.err).toMatchObject({ name: 'Error', message: 'bad' });
    expect(parsed.positionId).toBe('5');
  });

  it('drops entries below LOG_LEVEL', () => {
    process.env.LOG_LEVEL = 'warn';

    logger.info('quiet');
    logger.warn('loud');

    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledOnce();
  });
});
