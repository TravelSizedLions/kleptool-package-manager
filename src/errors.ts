import process from "node:process";
type KlepErrorOptions = {
  type: KlepErrorType
  id: string
  message?: string
  context?: unknown
}

type KlepErrorType = 'parsing' | 'argument' | 'git' | 'unknown'

export class KlepError extends Error {
  type: KlepErrorType
  id: string
  context: unknown
  message: string

  constructor(options: KlepErrorOptions) {
    super('')
    this.type = options.type
    this.id = options.id
    this.context = options.context || {}
    this.message = options.message || ''
  }
}

export function errorBoundary(fn: (...args: unknown[]) => Promise<void> | void) {
  return async (...args: unknown[]) => {
    try {
      await fn(...args);
    } catch (error) {
      if (!(error instanceof KlepError)) {
        console.error('unexpected error received', error)
        process.exit(1)
      }

      console.error(`${error.type} error:`, error.id)
      if (error.message) {
        console.error(`- message: ${error.message}`)
      }

      if (error.context) {
        __printErrorContext(error.context)
      }

      process.exit(1)
    }
  }
}

function __printErrorContext(context: unknown, level: number = 0, key: string = '', tick: string = '-') {
  if (Array.isArray(context)) {
    console.error(`${'  '.repeat(level)}${key ? `${tick} ${key}: ` : `${tick} `}`)
    for (const item of context) {
      __printErrorContext(item, level + 1, '', '.')
    }

    return
  }

  if (!!context && typeof context === 'object' && Object.keys(context).length > 0) {
    const entries = Object.entries(context)

    if (entries.length > 0) {
      for (const [key, value] of entries) {
        __printErrorContext(value, level, key)
      }
    }

    return
  }

  console.error(`${'  '.repeat(level)}${key ? `${tick} ${key}: ` : `${tick} `}${context}`)
}