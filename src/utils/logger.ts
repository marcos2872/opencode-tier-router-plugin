import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const PLUGIN_ROOT = fileURLToPath(new URL('../..', import.meta.url));

type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export class FileLogger {
  private path: string;
  private enabled = true;

  constructor(filename = 'router-debug.log') {
    this.path = join(PLUGIN_ROOT, filename);
    try {
      appendFileSync(this.path, '', 'utf-8');
    } catch {
      this.enabled = false;
    }
  }

  private ts(): string {
    return new Date().toISOString();
  }

  private write(level: LogLevel, ...args: unknown[]) {
    if (!this.enabled) return;
    const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
    try {
      appendFileSync(this.path, `${this.ts()} [${level}] ${msg}\n`, 'utf-8');
    } catch {
      this.enabled = false;
    }
  }

  debug(...args: unknown[]) { this.write('DEBUG', ...args); }
  info(...args: unknown[]) { this.write('INFO', ...args); }

  warn(...args: unknown[]) {
    this.write('WARN', ...args);
    console.warn(`[opencode-tier-router]`, ...args);
  }

  error(...args: unknown[]) {
    this.write('ERROR', ...args);
    console.error(`[opencode-tier-router]`, ...args);
  }
}
