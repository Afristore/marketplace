import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  logger,
  createLogger,
  isSensitiveKey,
  sanitizeString,
  replacer,
  LEVEL_PRIORITY,
  currentThreshold,
  LogLevel,
} from '../logger.js';

describe('logger-levels and JSON formatting', () => {
  const originalEnvLogLevel = process.env.LOG_LEVEL;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    delete process.env.LOG_LEVEL;
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalEnvLogLevel === undefined) {
      delete process.env.LOG_LEVEL;
    } else {
      process.env.LOG_LEVEL = originalEnvLogLevel;
    }
  });

  describe('JSON output structure and formatting', () => {
    it('outputs valid JSON terminated with a newline', () => {
      logger.info('test message');

      expect(stdoutSpy).toHaveBeenCalledOnce();
      const rawOutput = stdoutSpy.mock.calls[0][0] as string;
      expect(rawOutput.endsWith('\n')).toBe(true);

      const parsed = JSON.parse(rawOutput.trim());
      expect(parsed).toBeTypeOf('object');
      expect(parsed.msg).toBe('test message');
      expect(parsed.level).toBe('info');
      expect(parsed.time).toBeTypeOf('string');
      expect(new Date(parsed.time).toISOString()).toBe(parsed.time);
    });

    it('formats metadata and preserves primitive and complex types', () => {
      logger.info('action executed', {
        action: 'swap',
        count: 42,
        success: true,
        tags: ['soroban', 'marketplace'],
        details: { contract: 'CA123', ledger: 10050 },
        nullField: null,
      });

      const parsed = JSON.parse(stdoutSpy.mock.calls[0][0] as string);
      expect(parsed).toMatchObject({
        msg: 'action executed',
        level: 'info',
        action: 'swap',
        count: 42,
        success: true,
        tags: ['soroban', 'marketplace'],
        details: { contract: 'CA123', ledger: 10050 },
        nullField: null,
      });
    });

    it('handles calls without metadata fields', () => {
      logger.info('plain log entry');

      const parsed = JSON.parse(stdoutSpy.mock.calls[0][0] as string);
      expect(parsed).toEqual({
        time: expect.any(String),
        level: 'info',
        msg: 'plain log entry',
      });
    });

    it('serializes BigInt values into strings without throwing TypeError', () => {
      logger.info('processed ledger amount', {
        positionId: 109923847293847293847n,
        amount: 5000000000000000000n,
      });

      const parsed = JSON.parse(stdoutSpy.mock.calls[0][0] as string);
      expect(parsed.positionId).toBe('109923847293847293847');
      expect(parsed.amount).toBe('5000000000000000000');
    });

    it('serializes Error instances into objects with name, message, and stack', () => {
      const error = new Error('RPC connection timeout');
      logger.error('failed transaction simulation', { err: error });

      const parsed = JSON.parse(stderrSpy.mock.calls[0][0] as string);
      expect(parsed.err).toBeDefined();
      expect(parsed.err.name).toBe('Error');
      expect(parsed.err.message).toBe('RPC connection timeout');
      expect(parsed.err.stack).toBeTypeOf('string');
      expect(parsed.err.stack).toContain('RPC connection timeout');
    });

    it('handles special characters, newlines, and unicode in message and fields', () => {
      logger.info('multi\nline message with quotes "json" & emojis 🚀✨', {
        unicodeNote: 'Afristore 🌍 $100 & "quotes"',
      });

      const raw = stdoutSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(raw);
      expect(parsed.msg).toBe('multi\nline message with quotes "json" & emojis 🚀✨');
      expect(parsed.unicodeNote).toBe('Afristore 🌍 $100 & "quotes"');
    });
  });

  describe('log level routing between stdout and stderr', () => {
    beforeEach(() => {
      process.env.LOG_LEVEL = 'debug';
    });

    it('routes debug and info to stdout only', () => {
      logger.debug('debug trace');
      logger.info('informational message');

      expect(stdoutSpy).toHaveBeenCalledTimes(2);
      expect(stderrSpy).not.toHaveBeenCalled();

      const debugLine = JSON.parse(stdoutSpy.mock.calls[0][0] as string);
      const infoLine = JSON.parse(stdoutSpy.mock.calls[1][0] as string);

      expect(debugLine.level).toBe('debug');
      expect(debugLine.msg).toBe('debug trace');
      expect(infoLine.level).toBe('info');
      expect(infoLine.msg).toBe('informational message');
    });

    it('routes warn and error to stderr only', () => {
      logger.warn('warning encountered');
      logger.error('critical failure');

      expect(stdoutSpy).not.toHaveBeenCalled();
      expect(stderrSpy).toHaveBeenCalledTimes(2);

      const warnLine = JSON.parse(stderrSpy.mock.calls[0][0] as string);
      const errorLine = JSON.parse(stderrSpy.mock.calls[1][0] as string);

      expect(warnLine.level).toBe('warn');
      expect(warnLine.msg).toBe('warning encountered');
      expect(errorLine.level).toBe('error');
      expect(errorLine.msg).toBe('critical failure');
    });
  });

  describe('LOG_LEVEL threshold filtering', () => {
    it('defaults to info threshold when LOG_LEVEL is not set', () => {
      delete process.env.LOG_LEVEL;

      logger.debug('should be dropped');
      logger.info('should be logged');
      logger.warn('should be logged');
      logger.error('should be logged');

      expect(stdoutSpy).toHaveBeenCalledOnce();
      expect(JSON.parse(stdoutSpy.mock.calls[0][0] as string).level).toBe('info');

      expect(stderrSpy).toHaveBeenCalledTimes(2);
      expect(JSON.parse(stderrSpy.mock.calls[0][0] as string).level).toBe('warn');
      expect(JSON.parse(stderrSpy.mock.calls[1][0] as string).level).toBe('error');
    });

    it('allows all levels when LOG_LEVEL is debug', () => {
      process.env.LOG_LEVEL = 'debug';

      logger.debug('debug log');
      logger.info('info log');
      logger.warn('warn log');
      logger.error('error log');

      expect(stdoutSpy).toHaveBeenCalledTimes(2);
      expect(stderrSpy).toHaveBeenCalledTimes(2);
    });

    it('filters out debug when LOG_LEVEL is info', () => {
      process.env.LOG_LEVEL = 'info';

      logger.debug('debug log');
      logger.info('info log');
      logger.warn('warn log');
      logger.error('error log');

      expect(stdoutSpy).toHaveBeenCalledOnce();
      expect(stderrSpy).toHaveBeenCalledTimes(2);
      expect(JSON.parse(stdoutSpy.mock.calls[0][0] as string).level).toBe('info');
    });

    it('filters out debug and info when LOG_LEVEL is warn', () => {
      process.env.LOG_LEVEL = 'warn';

      logger.debug('debug log');
      logger.info('info log');
      logger.warn('warn log');
      logger.error('error log');

      expect(stdoutSpy).not.toHaveBeenCalled();
      expect(stderrSpy).toHaveBeenCalledTimes(2);
      expect(JSON.parse(stderrSpy.mock.calls[0][0] as string).level).toBe('warn');
      expect(JSON.parse(stderrSpy.mock.calls[1][0] as string).level).toBe('error');
    });

    it('filters out debug, info, and warn when LOG_LEVEL is error', () => {
      process.env.LOG_LEVEL = 'error';

      logger.debug('debug log');
      logger.info('info log');
      logger.warn('warn log');
      logger.error('error log');

      expect(stdoutSpy).not.toHaveBeenCalled();
      expect(stderrSpy).toHaveBeenCalledOnce();
      expect(JSON.parse(stderrSpy.mock.calls[0][0] as string).level).toBe('error');
    });

    it('handles uppercase and whitespace in LOG_LEVEL case-insensitively', () => {
      process.env.LOG_LEVEL = '  DEBUG  ';
      logger.debug('debug with padded uppercase');
      expect(stdoutSpy).toHaveBeenCalledOnce();

      stdoutSpy.mockClear();
      stderrSpy.mockClear();

      process.env.LOG_LEVEL = 'WARN';
      logger.info('suppressed info');
      logger.warn('allowed warn');
      expect(stdoutSpy).not.toHaveBeenCalled();
      expect(stderrSpy).toHaveBeenCalledOnce();
    });

    it('falls back to info threshold for unknown or invalid LOG_LEVEL values', () => {
      process.env.LOG_LEVEL = 'unrecognized_level';

      logger.debug('should be dropped');
      logger.info('should be logged');
      logger.warn('should be logged');

      expect(stdoutSpy).toHaveBeenCalledOnce();
      expect(stderrSpy).toHaveBeenCalledOnce();
      expect(currentThreshold()).toBe(LEVEL_PRIORITY.info);
    });

    it('evaluates LOG_LEVEL dynamically per invocation without reloading module', () => {
      process.env.LOG_LEVEL = 'error';
      logger.info('dropped');
      expect(stdoutSpy).not.toHaveBeenCalled();

      process.env.LOG_LEVEL = 'info';
      logger.info('now logged');
      expect(stdoutSpy).toHaveBeenCalledOnce();

      process.env.LOG_LEVEL = 'debug';
      logger.debug('now debug is logged');
      expect(stdoutSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('child logger context and binding inheritance', () => {
    it('attaches child bindings to all log entries', () => {
      const child = logger.child({ component: 'poller', workerId: 7 });

      child.info('syncing ledgers', { ledger: 105 });

      expect(stdoutSpy).toHaveBeenCalledOnce();
      const parsed = JSON.parse(stdoutSpy.mock.calls[0][0] as string);
      expect(parsed).toMatchObject({
        component: 'poller',
        workerId: 7,
        msg: 'syncing ledgers',
        ledger: 105,
      });
    });

    it('merges bindings hierarchically across nested child loggers', () => {
      const crankLogger = logger.child({ service: 'crank' });
      const scannerLogger = crankLogger.child({ subtask: 'liquidation-scan' });

      scannerLogger.info('scanning positions');

      const parsed = JSON.parse(stdoutSpy.mock.calls[0][0] as string);
      expect(parsed.service).toBe('crank');
      expect(parsed.subtask).toBe('liquidation-scan');
      expect(parsed.msg).toBe('scanning positions');
    });

    it('allows call-site fields to override or supplement child bindings', () => {
      const child = logger.child({ status: 'pending', component: 'api' });

      child.info('status updated', { status: 'completed' });

      const parsed = JSON.parse(stdoutSpy.mock.calls[0][0] as string);
      expect(parsed.status).toBe('completed');
      expect(parsed.component).toBe('api');
    });

    it('does not leak child bindings back to parent logger', () => {
      const child = logger.child({ isolatedField: 'child-only' });
      child.info('from child');

      logger.info('from parent');

      const childCall = JSON.parse(stdoutSpy.mock.calls[0][0] as string);
      const parentCall = JSON.parse(stdoutSpy.mock.calls[1][0] as string);

      expect(childCall.isolatedField).toBe('child-only');
      expect(parentCall.isolatedField).toBeUndefined();
    });
  });

  describe('sensitive credential sanitization', () => {
    it('sanitizes common credential keys (password, secret, apiKey, token, privateKey, seed)', () => {
      logger.info('user configuration', {
        password: 'PlainTextPassword123!',
        passwd: 'alt_password',
        secret: 'top_secret_value',
        secretKey: '0x9876543210abcdef',
        secret_key: '0xabcdef1234567890',
        apiKey: 'sk_live_123456789',
        api_key: 'key_987654321',
        token: 'jwt.token.here',
        accessToken: 'at_abcdef',
        refreshToken: 'rt_fedcba',
        authToken: 'auth_token_val',
        authorization: 'Bearer secret_token',
        privateKey: '0xprivate_key_data',
        private_key: '0xalt_private_key',
        seed: 'SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        secretSeed: 'SBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
        mnemonic: 'twelve word secret mnemonic phrase seed words',
      });

      const parsed = JSON.parse(stdoutSpy.mock.calls[0][0] as string);
      expect(parsed.password).toBe('[REDACTED]');
      expect(parsed.passwd).toBe('[REDACTED]');
      expect(parsed.secret).toBe('[REDACTED]');
      expect(parsed.secretKey).toBe('[REDACTED]');
      expect(parsed.secret_key).toBe('[REDACTED]');
      expect(parsed.apiKey).toBe('[REDACTED]');
      expect(parsed.api_key).toBe('[REDACTED]');
      expect(parsed.token).toBe('[REDACTED]');
      expect(parsed.accessToken).toBe('[REDACTED]');
      expect(parsed.refreshToken).toBe('[REDACTED]');
      expect(parsed.authToken).toBe('[REDACTED]');
      expect(parsed.authorization).toBe('[REDACTED]');
      expect(parsed.privateKey).toBe('[REDACTED]');
      expect(parsed.private_key).toBe('[REDACTED]');
      expect(parsed.seed).toBe('[REDACTED]');
      expect(parsed.secretSeed).toBe('[REDACTED]');
      expect(parsed.mnemonic).toBe('[REDACTED]');
    });

    it('sanitizes nested credential fields within deep objects', () => {
      logger.info('database setup', {
        database: {
          host: 'postgres.internal',
          port: 5432,
          auth: {
            user: 'db_admin',
            password: 'super_secret_db_pass',
          },
        },
      });

      const parsed = JSON.parse(stdoutSpy.mock.calls[0][0] as string);
      expect(parsed.database.host).toBe('postgres.internal');
      expect(parsed.database.port).toBe(5432);
      expect(parsed.database.auth.user).toBe('db_admin');
      expect(parsed.database.auth.password).toBe('[REDACTED]');
    });

    it('sanitizes credential objects passed as metadata fields', () => {
      logger.info('auth credentials check', {
        credentials: { username: 'alice', pass: 'secret' },
        credential: 'api-credential-token',
      });

      const parsed = JSON.parse(stdoutSpy.mock.calls[0][0] as string);
      expect(parsed.credentials).toBe('[REDACTED]');
      expect(parsed.credential).toBe('[REDACTED]');
    });

    it('sanitizes keys ending with password, secret, apikey, and privatekey', () => {
      logger.info('custom credential names', {
        adminPassword: 'admin_pass_123',
        clientSecret: 'client_secret_xyz',
        stripeApiKey: 'sk_test_abc',
        signerPrivateKey: 'privkey_data',
      });

      const parsed = JSON.parse(stdoutSpy.mock.calls[0][0] as string);
      expect(parsed.adminPassword).toBe('[REDACTED]');
      expect(parsed.clientSecret).toBe('[REDACTED]');
      expect(parsed.stripeApiKey).toBe('[REDACTED]');
      expect(parsed.signerPrivateKey).toBe('[REDACTED]');
    });

    it('does NOT sanitize safe token identifiers like tokenId, tokenAddress, and tokenSymbol', () => {
      logger.info('token metadata', {
        tokenId: 101n,
        tokenAddress: 'CAS3J7GYLGXMF6TDJBBYYSE3V',
        tokenSymbol: 'USDC',
        tokenUri: 'https://ipfs.io/ipfs/QmHash',
        collateralToken: 'CD123',
        borrowToken: 'CD456',
        rewardToken: 'CD789',
      });

      const parsed = JSON.parse(stdoutSpy.mock.calls[0][0] as string);
      expect(parsed.tokenId).toBe('101');
      expect(parsed.tokenAddress).toBe('CAS3J7GYLGXMF6TDJBBYYSE3V');
      expect(parsed.tokenSymbol).toBe('USDC');
      expect(parsed.tokenUri).toBe('https://ipfs.io/ipfs/QmHash');
      expect(parsed.collateralToken).toBe('CD123');
      expect(parsed.borrowToken).toBe('CD456');
      expect(parsed.rewardToken).toBe('CD789');
    });

    it('redacts Bearer authorization tokens embedded in message strings', () => {
      logger.info('HTTP request to auth server with Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.k');

      const parsed = JSON.parse(stdoutSpy.mock.calls[0][0] as string);
      expect(parsed.msg).toBe('HTTP request to auth server with Bearer [REDACTED]');
    });

    it('redacts Stellar secret seed keys (S...) embedded in message strings', () => {
      const stellarSecret = 'S' + 'A'.repeat(55);
      logger.warn(`Loaded signer secret key: ${stellarSecret} for liquidation bot`);

      const parsed = JSON.parse(stderrSpy.mock.calls[0][0] as string);
      expect(parsed.msg).toBe('Loaded signer secret key: [REDACTED] for liquidation bot');
      expect(parsed.msg).not.toContain(stellarSecret);
    });

    it('redacts sensitive values contained inside Error message and stack', () => {
      const sensitiveErr = new Error('Auth header Bearer secret_session_token_123 failed validation');
      logger.error('Authentication failure', { err: sensitiveErr });

      const parsed = JSON.parse(stderrSpy.mock.calls[0][0] as string);
      expect(parsed.err.message).toBe('Auth header Bearer [REDACTED] failed validation');
      expect(parsed.err.message).not.toContain('secret_session_token_123');
      expect(parsed.err.stack).not.toContain('secret_session_token_123');
    });
  });

  describe('createLogger and custom stream options', () => {
    it('creates an independent logger writing to custom streams', () => {
      const customStdout: string[] = [];
      const customStderr: string[] = [];

      const customLogger = createLogger(
        { component: 'test-custom' },
        {
          stdout: { write: (str: string) => { customStdout.push(str); return true; } },
          stderr: { write: (str: string) => { customStderr.push(str); return true; } },
        },
      );

      customLogger.info('info custom', { customProp: 'hello' });
      customLogger.error('error custom', { errCode: 500 });

      expect(stdoutSpy).not.toHaveBeenCalled();
      expect(stderrSpy).not.toHaveBeenCalled();

      expect(customStdout.length).toBe(1);
      expect(customStderr.length).toBe(1);

      const parsedStdout = JSON.parse(customStdout[0].trim());
      expect(parsedStdout.component).toBe('test-custom');
      expect(parsedStdout.msg).toBe('info custom');
      expect(parsedStdout.customProp).toBe('hello');

      const parsedStderr = JSON.parse(customStderr[0].trim());
      expect(parsedStderr.component).toBe('test-custom');
      expect(parsedStderr.msg).toBe('error custom');
      expect(parsedStderr.errCode).toBe(500);
    });
  });

  describe('helper utility functions (unit coverage)', () => {
    it('validates isSensitiveKey against various key permutations', () => {
      expect(isSensitiveKey('')).toBe(false);
      expect(isSensitiveKey('password')).toBe(true);
      expect(isSensitiveKey('PASSWORD')).toBe(true);
      expect(isSensitiveKey('user_password')).toBe(true);
      expect(isSensitiveKey('clientSecret')).toBe(true);
      expect(isSensitiveKey('api_key')).toBe(true);
      expect(isSensitiveKey('tokenId')).toBe(false);
      expect(isSensitiveKey('token')).toBe(true);
      expect(isSensitiveKey('safeIdentifier')).toBe(false);
    });

    it('validates sanitizeString redacts tokens and stellar seeds', () => {
      expect(sanitizeString('regular text')).toBe('regular text');
      expect(sanitizeString('Bearer abc123def456')).toBe('Bearer [REDACTED]');
      expect(sanitizeString('Key ' + ('S' + 'A'.repeat(55)) + ' here')).toBe('Key [REDACTED] here');
    });

    it('validates replacer for BigInt, Error, sensitive keys, and plain values', () => {
      expect(replacer('password', 'val')).toBe('[REDACTED]');
      expect(replacer('count', 10n)).toBe('10');
      expect(replacer('', 50n)).toBe('50');
      expect(replacer('safe', 'normal')).toBe('normal');
      expect(replacer('safe', 'Bearer token123')).toBe('Bearer [REDACTED]');
    });
  });
});
