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
    normalizedPath.includes('/testing/moxxy.ts') || // Skip the moxxy system itself
    normalizedPath.includes('/testing/moxxy-simple.ts') || // Skip the simple moxxy system
    normalizedPath.includes('/testing/moxxy-new.ts') || // Skip the new moxxy system
    normalizedPath.includes('/testing/moxxy-transformer.ts') || // Skip the transformer
    normalizedPath.includes('/testing/extensions.ts') || // Skip the test extensions
    content.includes('☢️ NUCLEAR')
  );
}

function __shouldSkipImport(moduleName: string, filePath: string): boolean {
  // Always skip bun - it's special
  if (moduleName === 'bun') {
    return true;
  }

  // In test files, allow mocking EVERYTHING (including node: modules)
  if (filePath.includes('.spec.ts') || filePath.includes('.test.ts')) {
    return false;
  }

  // Allow mocking of specific packages that are commonly mocked in tests
  const mockablePackages = [
    'simple-git',
    'node:child_process',
    'node:fs',
    'node:path',
    'node:process',
  ];
  if (mockablePackages.includes(moduleName)) {
    return false;
  }

  // In non-test files, skip other built-in modules and external packages to protect production code
  if (
    moduleName.startsWith('node:') ||
    (!moduleName.startsWith('./') && !moduleName.startsWith('../'))
  ) {
    return true;
  }

  return false;
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
      importNames = destructuredMatch[1]
        .split(',')
        .map((name) => name.trim())
        .filter((name) => !name.startsWith('type ')) // Filter out type-only imports
        .map((name) => (name.includes(' as ') ? name.split(' as ')[1].trim() : name));
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
  importNames: string[],
  moduleAlreadyImported: boolean
): string {
  const moduleVar = __createModuleVarName(moduleName);
  const individualProxies = importNames
    .map((name) => `const ${name} = __moxxy__(${moduleVar}.${name}, '${name}', import.meta);`)
    .join('\n');

  if (moduleAlreadyImported) {
    // Just create the proxies, module is already imported
    return `${NUCLEAR_COMMENT}: Additional imports from ${moduleName}\n${individualProxies}`;
  } else {
    // Import the module and create proxies
    return `${NUCLEAR_COMMENT}: Make ${moduleName} injectable\nconst ${moduleVar} = await import('${moduleName}');\n${individualProxies}`;
  }
}

function __createDefaultReplacement(
  fullMatch: string,
  moduleName: string,
  importName: string,
  moduleAlreadyImported: boolean
): string {
  const moduleVar = __createModuleVarName(moduleName);

  if (moduleAlreadyImported) {
    // Just create the proxy, module is already imported
    return `${NUCLEAR_COMMENT}: Additional import from ${moduleName}\nconst ${importName} = __moxxy__(${moduleVar}.default, '${importName}', import.meta);`;
  } else {
    // Import the module and create proxy
    return `${NUCLEAR_COMMENT}: Make ${moduleName} injectable\nconst ${moduleVar} = await import('${moduleName}');\nconst ${importName} = __moxxy__(${moduleVar}.default, '${importName}', import.meta);`;
  }
}

function __createNamespaceReplacement(
  fullMatch: string,
  moduleName: string,
  importName: string,
  moduleAlreadyImported: boolean
): string {
  const moduleVar = __createModuleVarName(moduleName);

  if (moduleAlreadyImported) {
    // Just create the proxy, module is already imported
    return `${NUCLEAR_COMMENT}: Additional namespace import from ${moduleName}\nconst ${importName} = __moxxy__(${moduleVar}, '${importName}', import.meta);`;
  } else {
    // Import the module and create proxy (pass whole module, not .default)
    return `${NUCLEAR_COMMENT}: Make ${moduleName} injectable\nconst ${moduleVar} = await import('${moduleName}');\nconst ${importName} = __moxxy__(${moduleVar}, '${importName}', import.meta);`;
  }
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
  declaredNuclearVars: Set<string>,
  importedModules: Set<string>,
  filePath: string
): ImportProcessResult | null {
  const [fullMatch, importStatement, moduleName] = match;

  if (__shouldSkipImport(moduleName, filePath)) {
    return null;
  }

  const [importNames, isDestructured, isNamespace, isDefault] = __parseImportNames(importStatement);

  // Create a unique key for this specific import statement, not just the module
  const importKey = `${moduleName}::${importStatement}`;

  if (declaredNuclearVars.has(importKey)) {
    return null;
  }

  declaredNuclearVars.add(importKey);

  // Check if module was already imported
  const moduleAlreadyImported = importedModules.has(moduleName);
  importedModules.add(moduleName);

  const addedLines = __calculateAddedLines(isDestructured, importNames);
  const importName = importNames[0] || moduleName;

  const replacementCode = isDestructured
    ? __createDestructuredReplacement(fullMatch, moduleName, importNames, moduleAlreadyImported)
    : isNamespace
      ? __createNamespaceReplacement(fullMatch, moduleName, importName, moduleAlreadyImported)
      : __createDefaultReplacement(fullMatch, moduleName, importName, moduleAlreadyImported);

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
  const importMatches = contentToTransform.matchAll(
    /^import\s+(?!type\s)([^'"]*)\s+from\s+['"]([^'"]+)['"];?\s*$/gm
  );

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

    // Removed debug output

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

function __replacePrimitiveUsage(content: string, importReplacements: ImportReplacement[]): string {
  let transformedContent = content;

  // Extract all imported constant names from destructured imports
  const constantNames: string[] = [];

  for (const replacement of importReplacements) {
    // Look for destructured import patterns in the replacement code
    const constantMatches = replacement.replacement.matchAll(
      /const\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*__moxxy__/g
    );
    for (const match of constantMatches) {
      constantNames.push(match[1]);
    }
  }

  // Replace standalone constant usage (not as property access)
  // Only in actual code, not in the import declarations we just created
  for (const constantName of constantNames) {
    // First, split content to avoid touching import declarations
    const lines = transformedContent.split('\n');
    const transformedLines = lines.map((line, index) => {
      // Skip lines that contain __moxxy__ (these are our import declarations)
      if (line.includes('__moxxy__') || line.includes('☢️ NUCLEAR')) {
        return line;
      }

      // Skip type declarations and interfaces
      if (
        line.includes(': ') ||
        line.includes('<') ||
        line.includes('>') ||
        line.includes('interface ') ||
        line.includes('type ') ||
        line.includes('Promise<') ||
        line.includes('Array<') ||
        line.trim().startsWith('*') ||
        line.trim().startsWith('//')
      ) {
        return line;
      }

      // Only transform very specific patterns to avoid breaking object literals
      // Match: return constantName; or constantName as the only thing on a line
      const returnRegex = new RegExp(`\\breturn\\s+${constantName}\\s*;`, 'g');
      const standaloneLineRegex = new RegExp(`^\\s*${constantName}\\s*;?\\s*$`, 'g');

      let transformedLine = line;

      // Transform return statements
      transformedLine = transformedLine.replace(returnRegex, (match) => {
        return match.replace(
          constantName,
          `(${constantName}.valueOf ? ${constantName}.valueOf() : ${constantName})`
        );
      });

      // Transform standalone usage on its own line
      transformedLine = transformedLine.replace(standaloneLineRegex, (match) => {
        return match.replace(
          constantName,
          `(${constantName}.valueOf ? ${constantName}.valueOf() : ${constantName})`
        );
      });

      return transformedLine;
    });

    transformedContent = transformedLines.join('\n');
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

function __setupMoxxy(isSpecFile: boolean): string {
  const moxxyCwd = process.cwd().replace(/\\/g, '/');
  let setupCode = `// Love, Moxxy ~<3
// Import the proxy helper
const { __moxxy__ } = await import('${moxxyCwd}/src/testing/moxxy.ts');
// Import the tilde syntax helper
const { __moxxyTilde__ } = await import('${moxxyCwd}/src/testing/moxxy.ts');

`;

  // Only add global moxxy to spec files
  if (isSpecFile) {
    setupCode += `// Global moxxy injector - lazy initialization to avoid module registration issues
let __globalMoxxy__;
Object.defineProperty(globalThis, 'moxxy', {
  get() {
    if (!__globalMoxxy__) {
      __globalMoxxy__ = __moxxyTilde__(import.meta);
    }
    return __globalMoxxy__;
  },
  configurable: true
});

`;
  }

  return setupCode;
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

      // Replace primitive usage to handle constants properly
      transformedContent = __replacePrimitiveUsage(transformedContent, importReplacements);

      // Create source map
      __createSourceMap(shebang, contentToTransform, args, generatedLineOffset);

      // Check if this is a spec file
      const isSpecFile = args.path.includes('.spec.');

      // Add moxxy setup
      const moxxyLines = __setupMoxxy(isSpecFile);
      const finalContent = shebang + moxxyLines + transformedContent;

      return {
        contents: finalContent,
        loader: 'tsx',
      };
    });
  },
});
