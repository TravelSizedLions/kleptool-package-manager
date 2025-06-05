import kerror from '../../cli/kerror.ts';

// ============================================================================
// Type Declarations and Interfaces
// ============================================================================

// Bun global is provided by runtime
declare const Bun: {
  file(path: string): { text(): Promise<string> };
  plugin(options: {
    name: string;
    setup(build: {
      onLoad(
        options: { filter: RegExp },
        callback: (args: { path: string }) => Promise<{ contents: string; loader: string }>
      ): void;
    }): void;
  }): void;
};

type TestFunction = (name: string, fn: () => void | Promise<void>) => unknown;

declare global {
  var originalTest: TestFunction | undefined;
  var test: TestFunction | undefined;
}

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

interface ImportParseResult {
  importNames: string[];
  isDestructured: boolean;
  isNamespace: boolean;
}

// ============================================================================
// File-wide Constants and Variables
// ============================================================================

const STACK_TRACE_PATTERNS = [
  /\s+at .* \((.+):(\d+):(\d+)\)/, // at function (file:line:col)
  /\s+at (.+):(\d+):(\d+)/, // at file:line:col
  /\s+at <anonymous> \((.+):(\d+):(\d+)\)/, // at <anonymous> (file:line:col)
];

const MOXXY_COMMENT = '// [moxxy]';
const MAX_TRANSLATION_ERRORS = 3;
const SPECIFIC_PROPS = ['env', 'argv', 'cwd', 'version', 'platform'];

const MOCKABLE_PACKAGES = [
  'simple-git',
  'node:child_process',
  'node:fs',
  'node:path',
  'node:process',
  'child_process',
  'fs',
  'path',
  'process',
  'globby',
];

const MOXXY_CWD = process.cwd().replace(/\\/g, '/');
const NUCLEAR_SETUP_LINES = 6;
const SHEBANG_PREFIX = '#!';

const IMPORT_REGEX =
  /import\s+(?!type\s)([\s\S]*?)\s+from\s+['"]([^'"]+)[''](\s+with\s+\{[^}]*\})?;?\s*/g;
const DESTRUCTURED_IMPORT_REGEX = /\{\s*([^}]+)\s*\}/;
const NAMESPACE_IMPORT_REGEX = /\*\s+as\s+(\w+)/;
const DEFAULT_IMPORT_REGEX = /^(\w+)/;
const CONSTANT_PROXY_REGEX = /const\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*__moxxy__/g;

// File path constants
const TESTING_DIR = '/testing/';
const CLI_DIR = '/cli/';
const SRC_INDEX_PATH = 'src/index.ts';
const SRC_MAIN_PATH = '/src/main.ts';
const SPEC_EXTENSION = '.spec.ts';
const TEST_EXTENSION = '.test.ts';
const SPEC_DOT = '.spec.';

// Moxxy system file paths
const MOXXY_CORE_PATH = '/testing/moxxy/moxxy.ts';
const MOXXY_TRANSFORMER_PATH = '/testing/moxxy/transformer-plugin.ts';
const TESTING_EXTENSIONS_PATH = '/testing/extensions.ts';

// Console messages
const MSG_STACK_TRANSLATION_FAILED = '⚠️  Stack trace translation failed';
const MSG_STACK_TRANSLATION_DISABLED =
  '🚫 Stack trace translation disabled due to repeated failures';
const MSG_SETTING_UP_ERROR_BOUNDARIES = '🛡️  Setting up test error boundaries...';
const MSG_ERROR_BOUNDARIES_ACTIVATED =
  '🛡️  Test error boundaries activated with source map translation!';
const MSG_UNCAUGHT_EXCEPTION = '❌ Uncaught Exception:';
const MSG_UNCAUGHT_EXCEPTION_FAILED = '❌ Uncaught Exception (translation failed):';
const MSG_UNHANDLED_REJECTION = '❌ Unhandled Rejection:';
const MSG_UNHANDLED_REJECTION_FAILED = '❌ Unhandled Rejection (translation failed):';
const MSG_SKIPPING_MACOS = '🍎 Skipping error boundaries on macOS due to compatibility issues';
const MSG_SETUP_FAILED = '⚠️  Failed to setup error boundaries:';

// Code analysis patterns
const TYPE_PREFIX = 'type ';
const AS_KEYWORD = ' as ';
const NAMESPACE_AS = '* as ';
const CURLY_OPEN = '{';
const CURLY_CLOSE = '}';
const TYPE_COLON = ': ';
const ANGLE_OPEN = '<';
const ANGLE_CLOSE = '>';
const INTERFACE_KEYWORD = 'interface ';
const TYPE_KEYWORD = 'type ';
const PROMISE_TYPE = 'Promise<';
const ARRAY_TYPE = 'Array<';
const COMMENT_ASTERISK = '*';
const COMMENT_DOUBLE_SLASH = '//';

// Path patterns
const SLASH = '/';
const DOT = '.';
const NODE_MODULES = 'node_modules';
const BUN_PREFIX = 'bun:';
const NATIVE = 'native';
const NODE_PREFIX = 'node:';
const RELATIVE_CURRENT = './';
const RELATIVE_PARENT = '../';

const GLOBAL_MOXXY_INJECTOR = `
// Global moxxy injector - lazy initialization to avoid module registration issues
let __globalMoxxy__;
Object.defineProperty(globalThis, 'moxxy', {
  get() {
    if (!__globalMoxxy__) {
      __globalMoxxy__ = __create_moxxy_global_object__(import.meta);
    }
    return __globalMoxxy__;
  },
  configurable: true
});

`;

const MOXXY_IMPORT = `
// With love, Moxxy ~<3
const { __moxxy__ } = await import('${MOXXY_CWD}/src/testing/moxxy/moxxy.ts');
const { __create_moxxy_global_object__ } = await import('${MOXXY_CWD}/src/testing/moxxy/moxxy.ts');

`;

// OS platform
const DARWIN_PLATFORM = 'darwin';

const sourceMapRegistry = new Map<string, SourceMapEntry[]>();

let isTranslatingStackTrace = false;
let translationErrorCount = 0;
let originalConsoleError: (...args: unknown[]) => void;

// ============================================================================
// Stack Trace Processing Helper Functions
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
    filePath === NATIVE ||
    !filePath.includes(SLASH) ||
    !filePath.includes(DOT) ||
    filePath.includes(NODE_MODULES) ||
    filePath.startsWith(BUN_PREFIX)
  );
}

function __calculateOriginalLineNumber(bestMapping: SourceMapEntry, originalLine: number): number {
  const offsetWithinMapping = originalLine - bestMapping.generatedLine;
  return bestMapping.originalLine + offsetWithinMapping;
}

function __translateSingleStackLine(line: string): string {
  const match = __findStackTraceMatch(line);
  if (!match) return line;

  const filePath = match[1];
  const originalLine = parseInt(match[2], 10);

  if (__shouldSkipStackTranslation(filePath)) return line;

  const mappings = sourceMapRegistry.get(filePath);
  if (!mappings || mappings.length === 0) return line;

  const bestMapping = __findBestMapping(mappings, originalLine);
  if (!bestMapping) return line;

  const originalLineNumber = __calculateOriginalLineNumber(bestMapping, originalLine);
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

// ============================================================================
// Stack Trace Translation Functions
// ============================================================================

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
      `${MSG_STACK_TRANSLATION_FAILED} (${translationErrorCount}/${MAX_TRANSLATION_ERRORS}):`,
      errorMessage
    );

    if (translationErrorCount >= MAX_TRANSLATION_ERRORS) {
      console.warn(MSG_STACK_TRANSLATION_DISABLED);
    }

    return error;
  } finally {
    isTranslatingStackTrace = false;
  }
}

// ============================================================================
// Test Function Wrapping Helper Functions
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

  console.log(MSG_SETTING_UP_ERROR_BOUNDARIES);
  globalThis.originalTest = globalThis.test;

  if (!globalThis.originalTest) {
    throw kerror(kerror.type.Unknown, 'test_function_undefined', {
      message: 'Original test function is undefined',
    });
  }

  globalThis.test = __createWrappedTestFunction(globalThis.originalTest);
  console.log(MSG_ERROR_BOUNDARIES_ACTIVATED);
}

// ============================================================================
// Process Error Handler Helper Functions
// ============================================================================

function __handleUncaughtException(error: Error): void {
  try {
    const translated = translateStackTrace(error);
    console.error(MSG_UNCAUGHT_EXCEPTION, translated);
  } catch {
    console.error(MSG_UNCAUGHT_EXCEPTION_FAILED, error);
  }
  process.exit(1);
}

function __handleUnhandledRejection(reason: unknown): void {
  try {
    if (reason instanceof Error) {
      const translated = translateStackTrace(reason);
      console.error(MSG_UNHANDLED_REJECTION, translated);
    } else {
      console.error(MSG_UNHANDLED_REJECTION, reason);
    }
  } catch {
    console.error(MSG_UNHANDLED_REJECTION_FAILED, reason);
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
// Console Error Patching Helper Functions
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
// Transformation Skip Logic Helper Functions
// ============================================================================

function __isTestFile(normalizedPath: string): boolean {
  return normalizedPath.endsWith(SPEC_EXTENSION) || normalizedPath.endsWith(TEST_EXTENSION);
}

function __isInTestingDirectory(normalizedPath: string): boolean {
  return normalizedPath.includes(TESTING_DIR);
}

function __isCliModule(normalizedPath: string): boolean {
  return normalizedPath.includes(CLI_DIR) && !normalizedPath.includes(SRC_INDEX_PATH);
}

function __isMainEntryPoint(normalizedPath: string): boolean {
  return normalizedPath.endsWith(`/${SRC_INDEX_PATH}`) || normalizedPath.endsWith(SRC_MAIN_PATH);
}

function __isMoxxySystemFile(normalizedPath: string, content: string): boolean {
  return (
    normalizedPath.includes(MOXXY_CORE_PATH) ||
    normalizedPath.includes(MOXXY_TRANSFORMER_PATH) ||
    normalizedPath.includes(TESTING_EXTENSIONS_PATH) ||
    content.includes(MOXXY_COMMENT)
  );
}

function __shouldSkipTransformation(args: { path: string }, content: string): boolean {
  const normalizedPath = args.path.replace(/\\/g, '/');

  if (__isMoxxySystemFile(normalizedPath, content)) return true;
  if (__isMainEntryPoint(normalizedPath)) return true;

  const isTestFile = __isTestFile(normalizedPath);
  const isInTestingDirectory = __isInTestingDirectory(normalizedPath);
  const isCliModule = __isCliModule(normalizedPath);

  return !(isTestFile || isInTestingDirectory || isCliModule);
}

function __shouldSkipImport(moduleName: string, filePath: string): boolean {
  if (moduleName === 'bun') return true;

  if (filePath.includes(SPEC_EXTENSION) || filePath.includes(TEST_EXTENSION)) {
    return false;
  }

  if (MOCKABLE_PACKAGES.includes(moduleName)) return false;

  if (
    moduleName.startsWith(NODE_PREFIX) ||
    (!moduleName.startsWith(RELATIVE_CURRENT) && !moduleName.startsWith(RELATIVE_PARENT))
  ) {
    return true;
  }

  return false;
}

// ============================================================================
// Content Processing Helper Functions
// ============================================================================

function __extractShebang(content: string): [string, string] {
  if (!content.startsWith(SHEBANG_PREFIX)) return ['', content];

  const firstNewline = content.indexOf('\n');
  if (firstNewline === -1) return ['', content];

  return [content.slice(0, firstNewline + 1), content.slice(firstNewline + 1)];
}

function __parseDestructuredImports(trimmed: string): string[] {
  const destructuredMatch = trimmed.match(DESTRUCTURED_IMPORT_REGEX);
  if (!destructuredMatch) return [];

  return destructuredMatch[1]
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name && !name.startsWith(TYPE_PREFIX))
    .map((name) => (name.includes(AS_KEYWORD) ? name.split(AS_KEYWORD)[1].trim() : name));
}

function __parseNamespaceImport(trimmed: string): string[] {
  const namespaceMatch = trimmed.match(NAMESPACE_IMPORT_REGEX);
  return namespaceMatch ? [namespaceMatch[1]] : [];
}

function __parseDefaultImport(trimmed: string): string[] {
  const defaultMatch = trimmed.match(DEFAULT_IMPORT_REGEX);
  return defaultMatch ? [defaultMatch[1]] : [];
}

function __parseImportNames(importStatement: string): ImportParseResult {
  const trimmed = importStatement.replace(/\s+/g, ' ').trim();
  let importNames: string[] = [];
  let isDestructured = false;
  let isNamespace = false;

  if (trimmed.startsWith(CURLY_OPEN) && trimmed.includes(CURLY_CLOSE)) {
    isDestructured = true;
    importNames = __parseDestructuredImports(trimmed);
  } else if (trimmed.includes(NAMESPACE_AS)) {
    isNamespace = true;
    importNames = __parseNamespaceImport(trimmed);
  } else {
    importNames = __parseDefaultImport(trimmed);
  }

  return { importNames, isDestructured, isNamespace };
}

// ============================================================================
// Module Name Generation Helper Functions
// ============================================================================

function __createModuleVarName(moduleName: string): string {
  return `__moxxy_module_${moduleName.replace(/[^a-zA-Z0-9]/g, '_')}`;
}

function __createProxyVarName(moduleName: string): string {
  return `__moxxy_${moduleName.replace(/[^a-zA-Z0-9]/g, '_')}`;
}

// ============================================================================
// Import Replacement Creation Helper Functions
// ============================================================================

function __createImportStatement(moduleName: string, importAssertion?: string): string {
  return importAssertion
    ? `await import('${moduleName}')${importAssertion}`
    : `await import('${moduleName}')`;
}

function __createIndividualProxies(importNames: string[], moduleVar: string): string {
  return importNames
    .map((name) => `const ${name} = __moxxy__(${moduleVar}.${name}, '${name}', import.meta);`)
    .join('\n');
}

function __createDestructuredReplacement(
  fullMatch: string,
  moduleName: string,
  importNames: string[],
  moduleAlreadyImported: boolean,
  importAssertion?: string
): string {
  const moduleVar = __createModuleVarName(moduleName);
  const individualProxies = __createIndividualProxies(importNames, moduleVar);
  const importStatement = __createImportStatement(moduleName, importAssertion);

  if (moduleAlreadyImported) {
    return `${MOXXY_COMMENT}: Additional imports from ${moduleName}\n${individualProxies}`;
  }

  return `${MOXXY_COMMENT}: Make ${moduleName} injectable\nconst ${moduleVar} = ${importStatement};\n${individualProxies}`;
}

function __createDefaultReplacement(
  fullMatch: string,
  moduleName: string,
  importName: string,
  moduleAlreadyImported: boolean,
  importAssertion?: string
): string {
  const moduleVar = __createModuleVarName(moduleName);
  const importStatement = __createImportStatement(moduleName, importAssertion);

  if (moduleAlreadyImported) {
    return `${MOXXY_COMMENT}: Additional import from ${moduleName}\nconst ${importName} = __moxxy__(${moduleVar}.default, '${importName}', import.meta);`;
  }

  return `${MOXXY_COMMENT}: Make ${moduleName} injectable\nconst ${moduleVar} = ${importStatement};\nconst ${importName} = __moxxy__(${moduleVar}.default, '${importName}', import.meta);`;
}

function __createNamespaceReplacement(
  fullMatch: string,
  moduleName: string,
  importName: string,
  moduleAlreadyImported: boolean,
  importAssertion?: string
): string {
  const moduleVar = __createModuleVarName(moduleName);
  const importStatement = __createImportStatement(moduleName, importAssertion);

  if (moduleAlreadyImported) {
    return `${MOXXY_COMMENT}: Additional namespace import from ${moduleName}\nconst ${importName} = __moxxy__(${moduleVar}, '${importName}', import.meta);`;
  }

  return `${MOXXY_COMMENT}: Make ${moduleName} injectable\nconst ${moduleVar} = ${importStatement};\nconst ${importName} = __moxxy__(${moduleVar}, '${importName}', import.meta);`;
}

function __calculateAddedLines(isDestructured: boolean, importNames: string[]): number {
  if (isDestructured) {
    return 2 + importNames.length;
  }
  return 2;
}

// ============================================================================
// Import Processing Functions
// ============================================================================

function __processImportMatch(
  match: RegExpMatchArray,
  moduleNamesMap: Map<string, string>,
  declaredNuclearVars: Set<string>,
  importedModules: Set<string>,
  filePath: string
): ImportProcessResult | null {
  const [fullMatch, importStatement, moduleName, importAssertion] = match;

  if (__shouldSkipImport(moduleName, filePath)) return null;

  const { importNames, isDestructured, isNamespace } = __parseImportNames(importStatement);
  const importKey = `${moduleName}::${importStatement}`;

  if (declaredNuclearVars.has(importKey)) return null;

  declaredNuclearVars.add(importKey);
  const moduleAlreadyImported = importedModules.has(moduleName);
  importedModules.add(moduleName);

  const addedLines = __calculateAddedLines(isDestructured, importNames);
  const importName = importNames[0] || moduleName;

  const replacementCode = isDestructured
    ? __createDestructuredReplacement(
        fullMatch,
        moduleName,
        importNames,
        moduleAlreadyImported,
        importAssertion
      )
    : isNamespace
      ? __createNamespaceReplacement(
          fullMatch,
          moduleName,
          importName,
          moduleAlreadyImported,
          importAssertion
        )
      : __createDefaultReplacement(
          fullMatch,
          moduleName,
          importName,
          moduleAlreadyImported,
          importAssertion
        );

  return {
    original: fullMatch,
    code: replacementCode,
    addedLines,
  };
}

function __processImports(
  contentToTransform: string,
  filePath: string
): [ImportReplacement[], Map<string, string>, number] {
  const importMatches = contentToTransform.matchAll(IMPORT_REGEX);

  const importReplacements: ImportReplacement[] = [];
  const declaredNuclearVars = new Set<string>();
  const importedModules = new Set<string>();
  const moduleNamesMap = new Map<string, string>();
  let generatedLineOffset = 0;

  for (const match of importMatches) {
    const replacement = __processImportMatch(
      match,
      moduleNamesMap,
      declaredNuclearVars,
      importedModules,
      filePath
    );
    if (!replacement) continue;

    generatedLineOffset += replacement.addedLines;
    importReplacements.push({
      original: replacement.original,
      replacement: replacement.code,
    });
  }

  return [importReplacements, moduleNamesMap, generatedLineOffset];
}

// ============================================================================
// Runtime Usage Replacement Helper Functions
// ============================================================================

function __createFunctionCallReplacement(
  importName: string,
  moduleName: string,
  match: string
): string {
  const varName = __createProxyVarName(moduleName);
  return match.replace(importName, `(${varName} || ${importName})`);
}

function __createPropertyReplacement(importName: string, moduleName: string, prop: string): string {
  const varName = __createProxyVarName(moduleName);
  return `(${varName} || ${importName}).${prop}`;
}

function __replaceRuntimeUsage(content: string, moduleNamesMap: Map<string, string>): string {
  let transformedContent = content;

  for (const [moduleName, importName] of moduleNamesMap) {
    const functionCallRegex = new RegExp(
      `(?<!\\.)\\b${importName}\\.[a-zA-Z_][a-zA-Z0-9_]*\\s*\\(`,
      'g'
    );

    transformedContent = transformedContent.replace(functionCallRegex, (match) => {
      return __createFunctionCallReplacement(importName, moduleName, match);
    });

    for (const prop of SPECIFIC_PROPS) {
      const propRegex = new RegExp(`(?<!\\.)\\b${importName}\\.${prop}\\b`, 'g');
      transformedContent = transformedContent.replace(propRegex, () => {
        return __createPropertyReplacement(importName, moduleName, prop);
      });
    }
  }

  return transformedContent;
}

// ============================================================================
// Primitive Usage Replacement Helper Functions
// ============================================================================

function __shouldSkipLine(line: string): boolean {
  return (
    line.includes('__moxxy__') ||
    line.includes(MOXXY_COMMENT) ||
    line.includes(TYPE_COLON) ||
    line.includes(ANGLE_OPEN) ||
    line.includes(ANGLE_CLOSE) ||
    line.includes(INTERFACE_KEYWORD) ||
    line.includes(TYPE_KEYWORD) ||
    line.includes(PROMISE_TYPE) ||
    line.includes(ARRAY_TYPE) ||
    line.trim().startsWith(COMMENT_ASTERISK) ||
    line.trim().startsWith(COMMENT_DOUBLE_SLASH)
  );
}

function __transformConstantUsage(line: string, constantName: string): string {
  const returnRegex = new RegExp(`\\breturn\\s+${constantName}\\s*;`, 'g');
  const standaloneLineRegex = new RegExp(`^\\s*${constantName}\\s*;?\\s*$`, 'g');

  let transformedLine = line;

  transformedLine = transformedLine.replace(returnRegex, (match) => {
    return match.replace(
      constantName,
      `(${constantName}.valueOf ? ${constantName}.valueOf() : ${constantName})`
    );
  });

  transformedLine = transformedLine.replace(standaloneLineRegex, (match) => {
    return match.replace(
      constantName,
      `(${constantName}.valueOf ? ${constantName}.valueOf() : ${constantName})`
    );
  });

  return transformedLine;
}

function __extractConstantNames(importReplacements: ImportReplacement[]): string[] {
  const constantNames: string[] = [];

  for (const replacement of importReplacements) {
    const constantMatches = replacement.replacement.matchAll(CONSTANT_PROXY_REGEX);
    for (const match of constantMatches) {
      constantNames.push(match[1]);
    }
  }

  return constantNames;
}

function __replacePrimitiveUsage(content: string, importReplacements: ImportReplacement[]): string {
  let transformedContent = content;
  const constantNames = __extractConstantNames(importReplacements);

  for (const constantName of constantNames) {
    const lines = transformedContent.split('\n');
    const transformedLines = lines.map((line) => {
      if (__shouldSkipLine(line)) return line;
      return __transformConstantUsage(line, constantName);
    });

    transformedContent = transformedLines.join('\n');
  }

  return transformedContent;
}

// ============================================================================
// Source Map Creation Functions
// ============================================================================

function __createSourceMap(
  shebang: string,
  contentToTransform: string,
  args: { path: string },
  generatedLineOffset: number
): void {
  const sourceMapEntries: SourceMapEntry[] = [];
  const originalLines = (shebang + contentToTransform).split('\n');
  const shebangLines = shebang ? 1 : 0;

  for (let i = 0; i < originalLines.length; i++) {
    sourceMapEntries.push({
      originalLine: i + 1,
      generatedLine: i + 1 + shebangLines + NUCLEAR_SETUP_LINES + generatedLineOffset,
      source: args.path,
    });
  }

  sourceMapRegistry.set(args.path, sourceMapEntries);
}

// ============================================================================
// Moxxy Setup Functions
// ============================================================================

function __setupMoxxy(isSpecFile: boolean): string {
  let setupCode = MOXXY_IMPORT;

  if (isSpecFile) {
    setupCode += GLOBAL_MOXXY_INJECTOR;
  }

  return setupCode;
}

// ============================================================================
// Main Setup Functions
// ============================================================================

function __setupErrorBoundaries() {
  if (process.platform === DARWIN_PLATFORM) {
    console.log(MSG_SKIPPING_MACOS);
    return;
  }

  try {
    __patchConsoleError();
    __setupProcessErrorHandlers();
    __wrapTestFunction();
  } catch (setupError) {
    console.warn(MSG_SETUP_FAILED, setupError);
  }
}

// ============================================================================
// Plugin Registration and Main Transform Function
// ============================================================================

__setupErrorBoundaries();

Bun.plugin({
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
      const [importReplacements, moduleNamesMap, generatedLineOffset] = __processImports(
        contentToTransform,
        args.path
      );

      let transformedContent = contentToTransform;
      for (const replacement of importReplacements) {
        transformedContent = transformedContent.replace(
          replacement.original,
          replacement.replacement
        );
      }

      transformedContent = __replaceRuntimeUsage(transformedContent, moduleNamesMap);
      transformedContent = __replacePrimitiveUsage(transformedContent, importReplacements);

      __createSourceMap(shebang, contentToTransform, args, generatedLineOffset);

      const isSpecFile = args.path.includes(SPEC_DOT);
      const moxxyLines = __setupMoxxy(isSpecFile);
      const finalContent = shebang + moxxyLines + transformedContent;

      return {
        contents: finalContent,
        loader: 'tsx',
      };
    });
  },
});
