
type KlepErrorOptions = {
  type: KlepErrorType
  id: string
  message?: string
  context?: Record<string, unknown>
}

type KlepErrorType = 'parsing' | 'argument' | 'git' | 'unknown'

export class KlepError extends Error {
  type: KlepErrorType
  id: string
  context: Record<string, unknown>
  message: string

  constructor(options: KlepErrorOptions) {
    super('')
    this.type = options.type
    this.id = options.id
    this.context = options.context || {}
    this.message = options.message || ''
  }
}

export function errorBoundary(fn: Function) {
  return async (...args: unknown[]) => {
    try {
      return await fn(...args)
    } catch (e) {
      if (!(e instanceof KlepError)) {
        console.error('unexpected error received', e)
        process.exit(1)
      }

      console.error(`${e.type} error:`, e.id)
      if (e.message) {
        console.error(` - message: ${e.message}`)
      }
      
      for (const [key, value] of Object.entries(e.context)) {
        console.error(` - ${key}:`, value)
      }

      process.exit(1)
    }
  }
}