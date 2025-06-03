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

// Import source map translation for automatic stack trace fixing
let translateStackTrace: ((error: Error) => Error) | null = null;

// Lazy load to avoid circular dependencies
async function getTranslateStackTrace() {
  if (!translateStackTrace) {
    try {
      const transformPlugin = await import('../testing/moxxy-transformer.ts');
      translateStackTrace = transformPlugin.translateStackTrace || ((e: Error) => e);
    } catch {
      // If the testing system isn't available, just use identity function
      translateStackTrace = (e: Error) => e;
    }
  }
  return translateStackTrace;
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
 * Stack traces are automatically translated to show correct line numbers.
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function boundary(fn: (...args: any[]) => Promise<void> | void) {
  // `any` is the appropriate type for these function signatures, as
  // we don't know the type of the function in advance, we allow any signature,
  // and every signature is valid. Using `unknown` would offer no benefit and
  // would require unnecessary type assertions.

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async (...args: any[]) => {
    try {
      await fn(...args);
    } catch (error: unknown) {
      // Translate stack traces for better debugging
      let processedError = error;
      if (error instanceof Error) {
        const translator = await getTranslateStackTrace();
        if (translator) {
          processedError = translator(error);
        }
      }

      if (!(processedError instanceof KlepError)) {
        console.error('unexpected error received', processedError);
        process.exit(1);
      }

      const klepError = processedError as KlepError;

      console.error(`${klepError.type} error:`, klepError.id);
      if (klepError.message) {
        console.error(`- message: ${klepError.message}`);
      }

      if (klepError.context) {
        __printErrorContext(klepError.context);
      }

      // Print stack trace with translated line numbers
      if (klepError.stack) {
        console.error(`- stack trace:`);
        console.error(klepError.stack);
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
