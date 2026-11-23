// Minimal structured logger: one JSON object per line, so log pipelines can
// filter on `level`, `component` and any other field instead of parsing text.
//
// LOG_LEVEL controls the threshold (debug | info | warn | error, default info).
// It is read on every call because dotenv loads .env after imports are evaluated.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

export interface LoggerOptions {
  stdout?: { write: (str: string) => void | boolean };
  stderr?: { write: (str: string) => void | boolean };
}

export function currentThreshold(): number {
  const configured = (process.env.LOG_LEVEL || 'info').trim().toLowerCase() as LogLevel;
  return LEVEL_PRIORITY[configured] ?? LEVEL_PRIORITY.info;
}

const SENSITIVE_KEY_NAMES = new Set([
  'password',
  'passwd',
  'secret',
  'secretkey',
  'secretseed',
  'clientsecret',
  'apikey',
  'token',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'authtoken',
  'sessiontoken',
  'csrftoken',
  'auth',
  'authorization',
  'authheader',
  'bearer',
  'bearertoken',
  'privatekey',
  'privkey',
  'credential',
  'credentials',
  'seed',
  'mnemonic',
]);

export function isSensitiveKey(key: string): boolean {
  if (!key) return false;
  const normalized = key.toLowerCase().replace(/[-_]/g, '');
  if (SENSITIVE_KEY_NAMES.has(normalized)) return true;
  if (normalized.endsWith('password') || normalized.endsWith('passwd')) return true;
  if (normalized.endsWith('secret') || normalized.endsWith('secretkey')) return true;
  if (normalized.endsWith('apikey')) return true;
  if (normalized.endsWith('privatekey') || normalized.endsWith('privkey')) return true;
  return false;
}

export function sanitizeString(str: string): string {
  // Redact Bearer tokens (e.g. Bearer eyJhbGci...)
  let result = str.replace(/Bearer\s+[A-Za-z0-9_\-.~+/=]+/gi, 'Bearer [REDACTED]');
  // Redact Stellar secret seeds (starts with S, 56 uppercase base32 chars)
  result = result.replace(/\bS[A-Z2-7]{55}\b/g, '[REDACTED]');
  return result;
}

// JSON.stringify drops Error message/stack and cannot encode BigInt.
// Also sanitizes sensitive keys and secret values.
export function replacer(key: string, value: unknown): unknown {
  if (key && isSensitiveKey(key)) {
    // If it's a container object (like `auth: { user, password }`), traverse into it
    if (
      key.toLowerCase().replace(/[-_]/g, '') === 'auth' &&
      typeof value === 'object' &&
      value !== null &&
      !(value instanceof Error)
    ) {
      return value;
    }
    return '[REDACTED]';
  }
  if (typeof value === 'string') {
    return sanitizeString(value);
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: sanitizeString(value.message),
      stack: value.stack ? sanitizeString(value.stack) : value.stack,
    };
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  return value;
}

export function createLogger(
  bindings: Record<string, unknown> = {},
  options?: LoggerOptions,
): Logger {
  const write = (level: LogLevel, msg: string, fields: Record<string, unknown> = {}) => {
    if (LEVEL_PRIORITY[level] < currentThreshold()) return;

    const line = JSON.stringify(
      { time: new Date().toISOString(), level, msg, ...bindings, ...fields },
      replacer,
    );
    const defaultStream = level === 'warn' || level === 'error' ? process.stderr : process.stdout;
    const stream = (level === 'warn' || level === 'error' ? options?.stderr : options?.stdout) ?? defaultStream;
    stream.write(`${line}\n`);
  };

  return {
    debug: (msg, fields) => write('debug', msg, fields),
    info: (msg, fields) => write('info', msg, fields),
    warn: (msg, fields) => write('warn', msg, fields),
    error: (msg, fields) => write('error', msg, fields),
    child: (extra) => createLogger({ ...bindings, ...extra }, options),
  };
}

export const logger: Logger = createLogger();

