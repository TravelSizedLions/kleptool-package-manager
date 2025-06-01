import process from 'node:process';

/**
 * KlepError types
 */
enum Type {
  Parsing = 'Parsing',
  Argument = 'Argument',
  Git = 'Git',
  Task = 'Task',
  Unknown = 'Unknown',
}

/**
 * KlepError options
 */
type KlepErrorOptions = {
  type: Type;
  id: string;
  message?: string;
  context?: unknown;
};

/**
 * KlepError is a custom error class that extends the built-in Error class.
 * It is used to create custom errors with a specific type, id, and context.
 * It is also used to print the error context in a readable format.
 *
 * @example
 *
 * ```ts
 * const error = new KlepError({
 *   type: Type.Parsing,
 *   id: '123',
 *   message: 'Parsing error',
 *   context: {
 *     file: 'index.js'
 *   }
 * })
 * ```
 */
class KlepError extends Error {
  type: Type;
  id: string;
  context?: unknown;

  constructor(options: KlepErrorOptions) {
    super('');
    this.type = options.type;
    this.id = options.id;
    this.context = options.context || {};
    this.message = options.message || '';
  }
}

function isKlepError(error: unknown): error is KlepError {
  return error instanceof KlepError;
}

/**
 * boundary is a function that wraps a function and catches any errors.
 * Useful for wrapping functions that may throw errors deep into the call stack.
 * Any error caught will be printed and the process will exit. KlepErrors will be specially formatted.
 *
 * @param fn - The function to wrap.
 * @returns A function that wraps the input function and catches any errors. May be an async function.
 *
 * @example
 *
 * ```ts
 * import kerror from './kerror.ts';
 *
 * const fn = kerror.boundary(async () => {
 *   throw kerror(kerror.Type.Parsing, '123', { message: 'Parsing error' });
 * });
 *
 * fn();
 *
 * console.log('makes it here safely');
 * ```
 */
function boundary(fn: (...args: unknown[]) => Promise<void> | void) {
  return async (...args: unknown[]) => {
    try {
      await fn(...args);
    } catch (error: unknown) {
      if (!(error instanceof KlepError)) {
        console.error('unexpected error received', error);
        process.exit(1);
      }

      const klepError = error as KlepError;

      console.error(`${klepError.type} error:`, klepError.id);
      if (klepError.message) {
        console.error(`- message: ${klepError.message}`);
      }

      if (klepError.context) {
        __printErrorContext(klepError.context);
      }

      process.exit(1);
    }
  };
}

function __printErrorContext(
  context: unknown,
  level: number = 0,
  key: string = '',
  tick: string = '-'
) {
  if (Array.isArray(context)) {
    console.error(`${'  '.repeat(level)}${key ? `${tick} ${key}: ` : `${tick} `}`);
    for (const item of context) {
      __printErrorContext(item, level + 1, '', '.');
    }

    return;
  }

  if (!!context && typeof context === 'object' && Object.keys(context).length > 0) {
    const entries = Object.entries(context);

    if (entries.length > 0) {
      for (const [key, value] of entries) {
        __printErrorContext(value, level, key);
      }
    }

    return;
  }

  console.error(`${'  '.repeat(level)}${key ? `${tick} ${key}: ` : `${tick} `}${context}`);
}

type KerrorFuncOptions = {
  [key: string]: unknown;
};

type KerrorFuncModule = {
  (type: Type, id: string, options?: KerrorFuncOptions): KlepError;
  type: typeof Type;
  KlepError: typeof KlepError;
  boundary: typeof boundary;
  isKlepError: (error: unknown) => error is KlepError;
} & typeof Type;

function _throw(type: Type, id: string, options: KerrorFuncOptions = {}) {
  const message = options.message as string;
  delete options.message;
  const context = options.context;

  return new KlepError({ type, id, message, context });
}

// Create the base function
const kerror = _throw as KerrorFuncModule;

const defineSettings = {
  writable: false,
  enumerable: false,
  configurable: false,
};

// Add static properties
Object.defineProperty(kerror, 'boundary', { ...defineSettings, value: boundary });

Object.defineProperty(kerror, 'isKlepError', { ...defineSettings, value: isKlepError });

Object.defineProperty(kerror, 'KlepError', { ...defineSettings, value: KlepError });

Object.defineProperty(kerror, 'type', { ...defineSettings, value: Type });

// Add type constants
for (const type of Object.values(Type)) {
  Object.defineProperty(kerror, type, { ...defineSettings, value: type });
  Object.defineProperty(kerror, type.toLowerCase(), { ...defineSettings, value: type });
}

export default kerror as KerrorFuncModule;
