import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger } from '../logger.js';

describe('logger-levels unit tests', () => {
  const originalLevel = process.env.LOG_LEVEL;
  let stdoutMock: ReturnType<typeof vi.spyOn>;
  let stderrMock: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    delete process.env.LOG_LEVEL;
    stdoutMock = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrMock = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalLevel === undefined) {
      delete process.env.LOG_LEVEL;
    } else {
      process.env.LOG_LEVEL = originalLevel;
    }
  });

  describe('JSON formatting & structure', () => {
    it('outputs valid JSON ending with a newline', () => {
      logger.info('test message', { requestId: 'req-123' });

      expect(stdoutMock).toHaveBeenCalledOnce();
      const output = stdoutMock.mock.calls[0][0] as string;
      expect(output.endsWith('\n')).toBe(true);

      const parsed = JSON.parse(output.trim());
      expect(parsed).toMatchObject({
        level: 'info',
        msg: 'test message',
        requestId: 'req-123',
      });
      expect(typeof parsed.time).toBe('string');
      expect(Number.isNaN(Date.parse(parsed.time))).toBe(false);
    });

    it('serializes BigInt fields properly without crashing JSON.stringify', () => {
      logger.info('amount calculation', {
        grossStroops: 1000000000000000000n,
      });

      const output = stdoutMock.mock.calls[0][0] as string;
      const parsed = JSON.parse(output.trim());
      expect(parsed.grossStroops).toBe('1000000000000000000');
    });

    it('serializes Error instances preserving name, message, and stack', () => {
      const err = new Error('Database connection failed');
      logger.error('uncaught error', { err });

      expect(stderrMock).toHaveBeenCalledOnce();
      const output = stderrMock.mock.calls[0][0] as string;
      const parsed = JSON.parse(output.trim());

      expect(parsed.err).toMatchObject({
        name: 'Error',
        message: 'Database connection failed',
      });
      expect(typeof parsed.err.stack).toBe('string');
    });

    it('sanitizes sensitive credential fields in metadata', () => {
      logger.info('credentials check', {
        password: 'super-secret-password',
        token: 'bearer-abc-123',
        apiKey: 'sk-9999999999',
        private_key: 'SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
        safeField: 'visible-value',
      });

      const output = stdoutMock.mock.calls[0][0] as string;
      const parsed = JSON.parse(output.trim());

      expect(parsed.password).toBe('[REDACTED]');
      expect(parsed.token).toBe('[REDACTED]');
      expect(parsed.apiKey).toBe('[REDACTED]');
      expect(parsed.private_key).toBe('[REDACTED]');
      expect(parsed.safeField).toBe('visible-value');
    });
  });

  describe('stream destination per log level', () => {
    it('routes debug and info to stdout', () => {
      process.env.LOG_LEVEL = 'debug';

      logger.debug('debug trace');
      logger.info('info message');

      expect(stdoutMock).toHaveBeenCalledTimes(2);
      expect(stderrMock).not.toHaveBeenCalled();

      const debugParsed = JSON.parse((stdoutMock.mock.calls[0][0] as string).trim());
      const infoParsed = JSON.parse((stdoutMock.mock.calls[1][0] as string).trim());

      expect(debugParsed.level).toBe('debug');
      expect(infoParsed.level).toBe('info');
    });

    it('routes warn and error to stderr', () => {
      logger.warn('warning alert');
      logger.error('critical failure');

      expect(stdoutMock).not.toHaveBeenCalled();
      expect(stderrMock).toHaveBeenCalledTimes(2);

      const warnParsed = JSON.parse((stderrMock.mock.calls[0][0] as string).trim());
      const errorParsed = JSON.parse((stderrMock.mock.calls[1][0] as string).trim());

      expect(warnParsed.level).toBe('warn');
      expect(errorParsed.level).toBe('error');
    });
  });

  describe('LOG_LEVEL threshold filtering', () => {
    it('defaults to info threshold when LOG_LEVEL is not set', () => {
      delete process.env.LOG_LEVEL;

      logger.debug('should be dropped');
      logger.info('should appear in stdout');
      logger.warn('should appear in stderr');
      logger.error('should appear in stderr');

      expect(stdoutMock).toHaveBeenCalledOnce();
      expect(stderrMock).toHaveBeenCalledTimes(2);

      const stdoutRecord = JSON.parse((stdoutMock.mock.calls[0][0] as string).trim());
      expect(stdoutRecord.msg).toBe('should appear in stdout');
    });

    it('allows all levels when LOG_LEVEL=debug', () => {
      process.env.LOG_LEVEL = 'debug';

      logger.debug('debug msg');
      logger.info('info msg');
      logger.warn('warn msg');
      logger.error('error msg');

      expect(stdoutMock).toHaveBeenCalledTimes(2);
      expect(stderrMock).toHaveBeenCalledTimes(2);
    });

    it('suppresses debug and info when LOG_LEVEL=warn', () => {
      process.env.LOG_LEVEL = 'warn';

      logger.debug('drop debug');
      logger.info('drop info');
      logger.warn('keep warn');
      logger.error('keep error');

      expect(stdoutMock).not.toHaveBeenCalled();
      expect(stderrMock).toHaveBeenCalledTimes(2);
    });

    it('suppresses debug, info, and warn when LOG_LEVEL=error', () => {
      process.env.LOG_LEVEL = 'error';

      logger.debug('drop debug');
      logger.info('drop info');
      logger.warn('drop warn');
      logger.error('keep error');

      expect(stdoutMock).not.toHaveBeenCalled();
      expect(stderrMock).toHaveBeenCalledOnce();
      const record = JSON.parse((stderrMock.mock.calls[0][0] as string).trim());
      expect(record.level).toBe('error');
    });

    it('handles uppercase and mixed-case LOG_LEVEL strings', () => {
      process.env.LOG_LEVEL = 'WARN';

      logger.info('drop info');
      logger.warn('keep warn');

      expect(stdoutMock).not.toHaveBeenCalled();
      expect(stderrMock).toHaveBeenCalledOnce();
    });

    it('falls back to default threshold on unrecognized LOG_LEVEL values', () => {
      process.env.LOG_LEVEL = 'verbose_unknown';

      logger.debug('drop debug');
      logger.info('keep info');

      expect(stdoutMock).toHaveBeenCalledOnce();
    });
  });

  describe('child logger behavior', () => {
    it('inherits parent bindings and merges new fields', () => {
      const child = logger.child({ service: 'indexer-crank', version: '2.0.0' });
      child.info('starting worker', { intervalMs: 5000 });

      expect(stdoutMock).toHaveBeenCalledOnce();
      const parsed = JSON.parse((stdoutMock.mock.calls[0][0] as string).trim());

      expect(parsed).toMatchObject({
        level: 'info',
        msg: 'starting worker',
        service: 'indexer-crank',
        version: '2.0.0',
        intervalMs: 5000,
      });
    });

    it('supports chained child logger bindings', () => {
      const parent = logger.child({ module: 'payments' });
      const nested = parent.child({ subsystem: 'settlement' });

      nested.warn('settlement delayed', { delaySec: 30 });

      expect(stderrMock).toHaveBeenCalledOnce();
      const parsed = JSON.parse((stderrMock.mock.calls[0][0] as string).trim());

      expect(parsed).toMatchObject({
        level: 'warn',
        msg: 'settlement delayed',
        module: 'payments',
        subsystem: 'settlement',
        delaySec: 30,
      });
    });
  });
});
