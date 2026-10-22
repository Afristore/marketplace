// Minimal structured logger: one JSON object per line, so log pipelines can
// filter on `level`, `component` and any other field instead of parsing text.
//
// LOG_LEVEL controls the threshold (debug | info | warn | error, default info).
// It is read on every call because dotenv loads .env after imports are evaluated.

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
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

function currentThreshold(): number {
  const configured = (process.env.LOG_LEVEL || 'info').toLowerCase() as LogLevel;
  return LEVEL_PRIORITY[configured] ?? LEVEL_PRIORITY.info;
}

// JSON.stringify drops Error message/stack and cannot encode BigInt.
function replacer(_key: string, value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  return value;
}

function createLogger(bindings: Record<string, unknown> = {}): Logger {
  const write = (level: LogLevel, msg: string, fields: Record<string, unknown> = {}) => {
    if (LEVEL_PRIORITY[level] < currentThreshold()) return;

    const line = JSON.stringify(
      { time: new Date().toISOString(), level, msg, ...bindings, ...fields },
      replacer,
    );
    const stream = level === 'warn' || level === 'error' ? process.stderr : process.stdout;
    stream.write(`${line}\n`);
  };

  return {
    debug: (msg, fields) => write('debug', msg, fields),
    info: (msg, fields) => write('info', msg, fields),
    warn: (msg, fields) => write('warn', msg, fields),
    error: (msg, fields) => write('error', msg, fields),
    child: (extra) => createLogger({ ...bindings, ...extra }),
  };
}

export const logger: Logger = createLogger();
