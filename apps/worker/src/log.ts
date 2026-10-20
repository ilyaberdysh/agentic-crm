// Minimal structured logger: one JSON object per line on stdout (pino-compatible field names, shipped to Loki like
// the API's pino output, D-22). Levels below LOG_LEVEL are dropped.
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const ORDER: Record<LogLevel, number> = { debug: 20, info: 30, warn: 40, error: 50, silent: 100 };

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

function serializeError(value: unknown): unknown {
  if (value instanceof Error) return { type: value.name, message: value.message, stack: value.stack };
  return value;
}

export function createLogger(
  level: LogLevel = 'info',
  name = 'worker',
  write: (line: string) => unknown = (line) => process.stdout.write(line),
): Logger {
  const threshold = ORDER[level];
  const emit = (lvl: Exclude<LogLevel, 'silent'>, msg: string, fields: Record<string, unknown> = {}) => {
    if (ORDER[lvl] < threshold) return;
    const entry: Record<string, unknown> = { level: ORDER[lvl], time: Date.now(), name, msg };
    for (const [k, v] of Object.entries(fields)) entry[k] = serializeError(v);
    write(`${JSON.stringify(entry)}\n`);
  };
  return {
    debug: (msg, fields) => emit('debug', msg, fields),
    info: (msg, fields) => emit('info', msg, fields),
    warn: (msg, fields) => emit('warn', msg, fields),
    error: (msg, fields) => emit('error', msg, fields),
  };
}
