import process from 'node:process'

type KlepErrorOptions = {
  type: Type
  id: string
  message?: string
  context?: unknown
}

enum Type {
  Parsing = 'Parsing',
  Argument = 'Argument',
  Git = 'Git',
  Unknown = 'Unknown',
}

class KlepError extends Error {
  type: Type
  id: string
  context?: unknown

  constructor(options: KlepErrorOptions) {
    super('')
    this.type = options.type
    this.id = options.id
    this.context = options.context || {}
    this.message = options.message || ''
  }
}

function boundary(fn: (...args: unknown[]) => Promise<void> | void) {
  return async (...args: unknown[]) => {
    try {
      await fn(...args)
    } catch (error: unknown) {
      if (!(error instanceof KlepError)) {
        console.error('unexpected error received', error)
        process.exit(1)
      }

      const klepError = error as KlepError

      console.error(`${klepError.type} error:`, klepError.id)
      if (klepError.message) {
        console.error(`- message: ${klepError.message}`)
      }

      if (klepError.context) {
        __printErrorContext(klepError.context)
      }

      process.exit(1)
    }
  }
}

function __printErrorContext(
  context: unknown,
  level: number = 0,
  key: string = '',
  tick: string = '-'
) {
  if (Array.isArray(context)) {
    console.error(
      `${'  '.repeat(level)}${key ? `${tick} ${key}: ` : `${tick} `}`
    )
    for (const item of context) {
      __printErrorContext(item, level + 1, '', '.')
    }

    return
  }

  if (
    !!context &&
    typeof context === 'object' &&
    Object.keys(context).length > 0
  ) {
    const entries = Object.entries(context)

    if (entries.length > 0) {
      for (const [key, value] of entries) {
        __printErrorContext(value, level, key)
      }
    }

    return
  }

  console.error(
    `${'  '.repeat(level)}${key ? `${tick} ${key}: ` : `${tick} `}${context}`
  )
}

type ErrorOptions = {
  [key: string]: unknown
}

interface KlepErrorFunction {
  (type: Type, id: string, options?: ErrorOptions): KlepError
  boundary: typeof boundary
  isKlepError: (error: unknown) => error is KlepError
  type: typeof Type
}

function _throw(type: Type, id: string, options: ErrorOptions = {}) {
  const message = options.message as string
  delete options.message
  const context = options.context as unknown

  return new KlepError({ type, id, message, context })
}

// Create the base function
const kerror = _throw as KlepErrorFunction

// Add static properties
Object.defineProperty(kerror, 'boundary', {
  value: boundary,
  writable: false,
  enumerable: false,
  configurable: false,
})

Object.defineProperty(kerror, 'isKlepError', {
  value: (error: unknown): error is KlepError => error instanceof KlepError,
  writable: false,
  enumerable: false,
  configurable: false,
})

// Add type constants
for (const type of Object.values(Type)) {
  Object.defineProperty(kerror, type, {
    value: type,
    writable: false,
    enumerable: false,
    configurable: false,
  })
}

export default kerror
