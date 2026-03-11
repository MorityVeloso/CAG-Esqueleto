/**
 * Logger — Simple structured logging for CAG-Esqueleto
 *
 * Respects log level from config.
 * Outputs JSON for structured log consumption.
 */

import type { LogLevel } from '@core/types.js';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export class Logger {
  private readonly level: number;
  private readonly prefix: string;

  constructor(level: LogLevel = 'info', prefix = 'CAG') {
    this.level = LOG_LEVELS[level];
    this.prefix = prefix;
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log('debug', message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log('info', message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log('warn', message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.log('error', message, context);
  }

  child(prefix: string): Logger {
    return new Logger(
      Object.entries(LOG_LEVELS).find(([, v]) => v === this.level)?.[0] as LogLevel ?? 'info',
      `${this.prefix}:${prefix}`,
    );
  }

  private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (LOG_LEVELS[level] < this.level) return;

    const entry = {
      timestamp: new Date().toISOString(),
      level,
      prefix: this.prefix,
      message,
      ...context,
    };

    switch (level) {
      case 'debug':
        // eslint-disable-next-line no-console
        console.debug(JSON.stringify(entry));
        break;
      case 'info':
        // eslint-disable-next-line no-console
        console.info(JSON.stringify(entry));
        break;
      case 'warn':
        console.warn(JSON.stringify(entry));
        break;
      case 'error':
        console.error(JSON.stringify(entry));
        break;
    }
  }
}
