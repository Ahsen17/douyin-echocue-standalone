import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type LogCategory = 'lifecycle' | 'telemetry' | 'storage' | 'window' | 'general'

export interface LogEntry {
  level: LogLevel
  category: LogCategory
  message: string
  errorCode?: string
}

export interface LoggerOptions {
  /**
   * Directory for daily log files (one `main-YYYY-MM-DD.log` per local date).
   * Omit for console-only output (used where no data dir is available).
   */
  logDir?: string
}

function dateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export class Logger {
  private readonly logDir: string | undefined

  constructor(options: LoggerOptions = {}) {
    this.logDir = options.logDir
  }

  log(entry: LogEntry): void {
    const line = JSON.stringify({ ...entry, t: new Date().toISOString() })
    if (entry.level === 'error' || entry.level === 'warn') {
      console.error(line)
    } else {
      console.log(line)
    }
    this.appendToDailyFile(line)
  }

  info(category: LogCategory, message: string): void {
    this.log({ level: 'info', category, message })
  }

  warn(category: LogCategory, message: string, errorCode?: string): void {
    this.log({ level: 'warn', category, message, errorCode })
  }

  error(category: LogCategory, message: string, errorCode?: string): void {
    this.log({ level: 'error', category, message, errorCode })
  }

  private appendToDailyFile(line: string): void {
    if (this.logDir === undefined) return
    try {
      // Recursive mkdir is a no-op after the first call; the try/catch keeps a
      // read-only or full data dir from taking the whole app down.
      mkdirSync(this.logDir, { recursive: true })
      const filePath = join(this.logDir, `main-${dateKey(new Date())}.log`)
      appendFileSync(filePath, `${line}\n`, 'utf8')
    } catch {
      /* logging must never break the app */
    }
  }
}
