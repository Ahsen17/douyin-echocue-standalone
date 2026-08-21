export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type LogCategory = 'lifecycle' | 'telemetry' | 'storage' | 'window' | 'general'

export interface LogEntry {
  level: LogLevel
  category: LogCategory
  message: string
  errorCode?: string
}

export class Logger {
  log(entry: LogEntry): void {
    const line = JSON.stringify({ ...entry, t: new Date().toISOString() })
    if (entry.level === 'error' || entry.level === 'warn') {
      console.error(line)
    } else {
      console.log(line)
    }
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
}
