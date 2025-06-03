import { plugin } from 'bun';
import kerror from '../cli/kerror.js';

// Bun global is provided by runtime
declare const Bun: {
  file(path: string): { text(): Promise<string> };
};

// Global declarations for test function wrapping
type TestFunction = (name: string, fn: () => void | Promise<void>) => unknown;

declare global {
  var originalTest: TestFunction | undefined;
  var test: TestFunction | undefined;
}

// File-wide constants
const STACK_TRACE_PATTERNS = [
  /\s+at .* \((.+):(\d+):(\d+)\)/, // at function (file:line:col)
  /\s+at (.+):(\d+):(\d+)/, // at file:line:col
  /\s+at <anonymous> \((.+):(\d+):(\d+)\)/, // at <anonymous> (file:line:col)
];

const NUCLEAR_COMMENT = '// ☢️ NUCLEAR';
const MAX_TRANSLATION_ERRORS = 3;
const SPECIFIC_PROPS = ['env', 'argv', 'cwd', 'version', 'platform'];

// File-wide variables
let isTranslatingStackTrace = false;
let translationErrorCount = 0;
let originalConsoleError: (...args: unknown[]) => void;

// Type declarations
interface SourceMapEntry {
  originalLine: number;
  generatedLine: number;
  source: string;
}

interface ImportReplacement {
  original: string;
  replacement: string;
}

interface ImportProcessResult {
  original: string;
  code: string;
  addedLines: number;
}

const sourceMapRegistry = new Map<string, SourceMapEntry[]>();

// ============================================================================
// Stack Trace Processing Functions
// ============================================================================

function __findStackTraceMatch(line: string) {
  for (const pattern of STACK_TRACE_PATTERNS) {
    const match = line.match(pattern);
    if (match) return match;
  }
  return null;
}

function __findBestMapping(mappings: SourceMapEntry[], originalLine: number) {
  for (const mapping of mappings) {
    if (originalLine >= mapping.generatedLine) {
      return mapping;
    }
  }
  return null;
}

function __shouldSkipStackTranslation(filePath: string): boolean {
  return (
    filePath === 'native' ||
    !filePath.includes('/') ||
    !filePath.includes('.') ||
    filePath.includes('node_modules') ||
    filePath.startsWith('bun:')
  );
}

function __translateSingleStackLine(line: string): string {
  const match = __findStackTraceMatch(line);
  if (!match) return line;

  const filePath = match[1];
  const originalLine = parseInt(match[2], 10);

  if (__shouldSkipStackTranslation(filePath)) {
    return line;
  }

  const mappings = sourceMapRegistry.get(filePath);
  if (!mappings || mappings.length === 0) {
    return line;
  }

  const bestMapping = __findBestMapping(mappings, originalLine);
  if (!bestMapping) {
    return line;
  }

  const offsetWithinMapping = originalLine - bestMapping.generatedLine;
  const originalLineNumber = bestMapping.originalLine + offsetWithinMapping;

  return line.replace(`:${originalLine}:`, `:${originalLineNumber}:`);
}

function __safelyModifyErrorStack(error: Error, translatedLines: string[]): Error {
  const originalStack = error.stack;
  try {
    error.stack = translatedLines.join('\n');
    return error;
  } catch {
    try {
      error.stack = originalStack;
    } catch {
      // If we can't even restore, just continue with the error as-is
    }
    return error;
  }
}

export function translateStackTrace(error: Error): Error {
  if (isTranslatingStackTrace || !error.stack || translationErrorCount >= MAX_TRANSLATION_ERRORS) {
    return error;
  }

  try {
    isTranslatingStackTrace = true;
    const lines = error.stack.split('\n');
    const translatedLines = lines.map(__translateSingleStackLine);
    return __safelyModifyErrorStack(error, translatedLines);
  } catch (translationError) {
    translationErrorCount++;
    const errorMessage =
      translationError instanceof Error ? translationError.message : String(translationError);

    console.warn(
      `⚠️  Stack trace translation failed (${translationErrorCount}/${MAX_TRANSLATION_ERRORS}):`,
      errorMessage
    );

    if (translationErrorCount >= MAX_TRANSLATION_ERRORS) {
      console.warn('🚫 Stack trace translation disabled due to repeated failures');
    }

    return error;
  } finally {
    isTranslatingStackTrace = false;
  }
}

// ============================================================================
// Test Function Wrapping
// ============================================================================

function __createWrappedTestFunction(originalTest: TestFunction): TestFunction {
  return function (name: string, fn: () => void | Promise<void>) {
    return originalTest(name, async () => {
      try {
        await fn();
      } catch (error) {
        if (error instanceof Error) {
          try {
            const translated = translateStackTrace(error);
            throw translated;
          } catch {
            throw error;
          }
        }
        throw error;
      }
    });
  };
}

function __wrapTestFunction(): void {
  if (!globalThis.test || globalThis.originalTest) return;

  console.log('🛡️  Setting up test error boundaries...');
  globalThis.originalTest = globalThis.test;

  if (!globalThis.originalTest) {
    throw kerror(kerror.type.Unknown, 'test_function_undefined', {
      message: 'Original test function is undefined',
    });
  }

  globalThis.test = __createWrappedTestFunction(globalThis.originalTest);
  console.log('🛡️  Test error boundaries activated with source map translation!');
}

// ============================================================================
// Process Error Handlers
// ============================================================================

function __handleUncaughtException(error: Error): void {
  try {
    const translated = translateStackTrace(error);
    console.error('❌ Uncaught Exception:', translated);
  } catch {
    console.error('❌ Uncaught Exception (translation failed):', error);
  }
  process.exit(1);
}

function __handleUnhandledRejection(reason: unknown): void {
  try {
    if (reason instanceof Error) {
      const translated = translateStackTrace(reason);
      console.error('❌ Unhandled Rejection:', translated);
    } else {
      console.error('❌ Unhandled Rejection:', reason);
    }
  } catch {
    console.error('❌ Unhandled Rejection (translation failed):', reason);
  }
  process.exit(1);
}

function __setupProcessErrorHandlers(): void {
  process.removeAllListeners('uncaughtException');
  process.removeAllListeners('unhandledRejection');
  process.on('uncaughtException', __handleUncaughtException);
  process.on('unhandledRejection', __handleUnhandledRejection);
}

// ============================================================================
// Console Error Patching
// ============================================================================

function __translateConsoleArgument(arg: unknown): unknown {
  if (arg instanceof Error && arg.stack) {
    try {
      return translateStackTrace(arg);
    } catch {
      return arg;
    }
  }
  return arg;
}

function __patchConsoleError(): void {
  originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    try {
      const translatedArgs = args.map(__translateConsoleArgument);
      originalConsoleError.apply(console, translatedArgs);
    } catch {
      originalConsoleError.apply(console, args);
    }
  };
}

// ============================================================================
// Transformation Skip Logic
// ============================================================================

function __shouldSkipTransformation(args: { path: string }, content: string): boolean {
  const normalizedPath = args.path.replace(/\\/g, '/');
  return (
    normalizedPath.includes('.spec.') ||
    normalizedPath.includes('/testing/') ||
    content.includes('☢️ NUCLEAR')
  );
}

function __shouldSkipImport(moduleName: string): boolean {
  return moduleName.startsWith('./') || moduleName.startsWith('../') || moduleName === 'bun';
}

// ============================================================================
// Content Processing Functions
// ============================================================================

function __extractShebang(content: string): [string, string] {
  if (!content.startsWith('#!')) return ['', content];

  const firstNewline = content.indexOf('\n');
  if (firstNewline === -1) return ['', content];

  return [content.slice(0, firstNewline + 1), content.slice(firstNewline + 1)];
}

function __parseImportNames(importStatement: string): [string[], boolean, boolean, boolean] {
  const trimmed = importStatement.trim();
  let importNames: string[] = [];
  let isDestructured = false;
  let isNamespace = false;
  let isDefault = false;

  if (trimmed.startsWith('{') && trimmed.includes('}')) {
    isDestructured = true;
    const destructuredMatch = trimmed.match(/\{\s*([^}]+)\s*\}/);
    if (destructuredMatch) {
      importNames = destructuredMatch[1].split(',').map((name) => name.trim());
    }
  } else if (trimmed.includes('* as ')) {
    isNamespace = true;
    const namespaceMatch = trimmed.match(/\*\s+as\s+(\w+)/);
    if (namespaceMatch) {
      importNames = [namespaceMatch[1]];
    }
  } else {
    isDefault = true;
    const defaultMatch = trimmed.match(/^(\w+)/);
    if (defaultMatch) {
      importNames = [defaultMatch[1]];
    }
  }

  return [importNames, isDestructured, isNamespace, isDefault];
}

function __createModuleVarName(moduleName: string): string {
  return `__moxxy_module_${moduleName.replace(/[^a-zA-Z0-9]/g, '_')}`;
}

function __createProxyVarName(moduleName: string): string {
  return `__moxxy_${moduleName.replace(/[^a-zA-Z0-9]/g, '_')}`;
}

function __createDestructuredReplacement(
  fullMatch: string,
  moduleName: string,
  importNames: string[]
): string {
  const moduleVar = __createModuleVarName(moduleName);
  const individualProxies = importNames
    .map((name) => `const ${name} = __moxxy__(${moduleVar}.${name}, '${name}', import.meta);`)
    .join('\n');

  return `${fullMatch}\n${NUCLEAR_COMMENT}: Make ${moduleName} injectable\nconst ${moduleVar} = await import('${moduleName}');\n${individualProxies}`;
}

function __createDefaultReplacement(
  fullMatch: string,
  moduleName: string,
  importName: string
): string {
  const varName = __createProxyVarName(moduleName);
  return `${fullMatch}\n${NUCLEAR_COMMENT}: Make ${moduleName} injectable\nconst ${varName} = __moxxy__(${importName}, '${importName}', import.meta);`;
}

function __calculateAddedLines(isDestructured: boolean, importNames: string[]): number {
  if (isDestructured) {
    return 2 + importNames.length; // comment + module import + individual proxies
  }
  return 2; // comment + proxy declaration
}

function __processImportMatch(
  match: RegExpMatchArray,
  moduleNamesMap: Map<string, string>,
  declaredNuclearVars: Set<string>
): ImportProcessResult | null {
  const [fullMatch, importStatement, moduleName] = match;

  if (__shouldSkipImport(moduleName)) {
    return null;
  }

  const [importNames, isDestructured] = __parseImportNames(importStatement);
  const varName = __createProxyVarName(moduleName);

  if (!isDestructured && importNames.length > 0) {
    moduleNamesMap.set(moduleName, importNames[0]);
  }

  if (declaredNuclearVars.has(varName)) {
    return null;
  }

  declaredNuclearVars.add(varName);

  const addedLines = __calculateAddedLines(isDestructured, importNames);
  const importName = importNames[0] || moduleName;

  const replacementCode = isDestructured
    ? __createDestructuredReplacement(fullMatch, moduleName, importNames)
    : __createDefaultReplacement(fullMatch, moduleName, importName);

  return {
    original: fullMatch,
    code: replacementCode,
    addedLines,
  };
}

function __processImports(
  contentToTransform: string
): [ImportReplacement[], Map<string, string>, number] {
  const importMatches = contentToTransform.matchAll(
    /^import\s+([^'"]*)\s+from\s+['"]([^'"]+)['"];?\s*$/gm
  );

  const importReplacements: ImportReplacement[] = [];
  const declaredNuclearVars = new Set<string>();
  const moduleNamesMap = new Map<string, string>();
  let generatedLineOffset = 0;

  for (const match of importMatches) {
    const replacement = __processImportMatch(match, moduleNamesMap, declaredNuclearVars);
    if (!replacement) continue;

    generatedLineOffset += replacement.addedLines;
    importReplacements.push({
      original: replacement.original,
      replacement: replacement.code,
    });
  }

  return [importReplacements, moduleNamesMap, generatedLineOffset];
}

function __replaceRuntimeUsage(content: string, moduleNamesMap: Map<string, string>): string {
  let transformedContent = content;

  for (const [moduleName, importName] of moduleNamesMap) {
    const varName = __createProxyVarName(moduleName);

    // Function calls with parentheses
    const functionCallRegex = new RegExp(
      `(?<!\\.)\\b${importName}\\.[a-zA-Z_][a-zA-Z0-9_]*\\s*\\(`,
      'g'
    );

    transformedContent = transformedContent.replace(functionCallRegex, (match) => {
      return match.replace(importName, `(${varName} || ${importName})`);
    });

    // Specific property access
    for (const prop of SPECIFIC_PROPS) {
      const propRegex = new RegExp(`(?<!\\.)\\b${importName}\\.${prop}\\b`, 'g');
      transformedContent = transformedContent.replace(propRegex, () => {
        return `(${varName} || ${importName}).${prop}`;
      });
    }
  }

  return transformedContent;
}

function __createSourceMap(
  shebang: string,
  contentToTransform: string,
  args: { path: string },
  generatedLineOffset: number
): void {
  const sourceMapEntries: SourceMapEntry[] = [];
  const originalLines = (shebang + contentToTransform).split('\n');
  const shebangLines = shebang ? 1 : 0;
  const nuclearSetupLines = 6;

  for (let i = 0; i < originalLines.length; i++) {
    sourceMapEntries.push({
      originalLine: i + 1, // 1-indexed
      generatedLine: i + 1 + shebangLines + nuclearSetupLines + generatedLineOffset,
      source: args.path,
    });
  }

  sourceMapRegistry.set(args.path, sourceMapEntries);
}

function __setupMoxxy(): string {
  const moxxyCwd = process.cwd().replace(/\\/g, '/');
  return `// Love, Moxxy ~<3
const { $ } = await import('${moxxyCwd}/src/testing/moxxy.ts');
const __registered = $(import.meta); // Register this module for nuclear injection

// Import the proxy helper
const { __moxxy__ } = await import('${moxxyCwd}/src/testing/moxxy.ts');

`;
}

// ============================================================================
// Main Setup Functions
// ============================================================================

function __setupErrorBoundaries() {
  // Disable error boundaries on macOS due to infinite recursion issues
  if (process.platform === 'darwin') {
    console.log('🍎 Skipping error boundaries on macOS due to compatibility issues');
    return;
  }

  try {
    __patchConsoleError();
    __setupProcessErrorHandlers();
    __wrapTestFunction();
  } catch (setupError) {
    console.warn('⚠️  Failed to setup error boundaries:', setupError);
  }
}

// ============================================================================
// Plugin Registration
// ============================================================================

// Initialize error boundaries
__setupErrorBoundaries();

// Register as Bun plugin for automatic transformation
plugin({
  name: 'Moxxy Dependency Injection',
  setup(build) {
    build.onLoad({ filter: /[/\\]src[/\\].*\.ts$/ }, async (args) => {
      const content = await Bun.file(args.path).text();

      if (__shouldSkipTransformation(args, content)) {
        return {
          contents: content,
          loader: 'tsx',
        };
      }

      const [shebang, contentToTransform] = __extractShebang(content);
      const [importReplacements, moduleNamesMap, generatedLineOffset] =
        __processImports(contentToTransform);

      // Apply import transformations
      let transformedContent = contentToTransform;
      for (const replacement of importReplacements) {
        transformedContent = transformedContent.replace(
          replacement.original,
          replacement.replacement
        );
      }

      // Replace direct usage with moxxy proxies
      transformedContent = __replaceRuntimeUsage(transformedContent, moduleNamesMap);

      // Create source map
      __createSourceMap(shebang, contentToTransform, args, generatedLineOffset);

      // Combine all parts
      const moxxyLines = __setupMoxxy();
      const finalContent = shebang + moxxyLines + transformedContent;

      return {
        contents: finalContent,
        loader: 'tsx',
      };
    });
  },
});
