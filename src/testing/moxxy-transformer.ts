import { plugin } from 'bun';

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

// Interface for source map support
interface SourceMapEntry {
  originalLine: number;
  generatedLine: number;
  source: string;
}

const sourceMapRegistry = new Map<string, SourceMapEntry[]>();

function findStackTraceMatch(line: string) {
  const patterns = [
    /\s+at .* \((.+):(\d+):(\d+)\)/, // at function (file:line:col)
    /\s+at (.+):(\d+):(\d+)/, // at file:line:col
    /\s+at <anonymous> \((.+):(\d+):(\d+)\)/, // at <anonymous> (file:line:col)
  ];

  for (const pattern of patterns) {
    const match = line.match(pattern);
    if (match) return match;
  }

  return null;
}

function findBestMapping(mappings: SourceMapEntry[], originalLine: number) {
  for (const mapping of mappings) {
    if (originalLine >= mapping.generatedLine) {
      return mapping;
    }
  }
  return null;
}

function translateSingleStackLine(line: string): string {
  const match = findStackTraceMatch(line);
  if (!match) return line;

  const filePath = match[1];
  const originalLine = parseInt(match[2], 10);

  // Skip native code or non-file paths to avoid errors
  if (filePath === 'native' || !filePath.includes('/') || !filePath.includes('.')) {
    return line;
  }

  const mappings = sourceMapRegistry.get(filePath);
  if (!mappings || mappings.length === 0) {
    // Don't log for native code or system files
    if (!filePath.includes('node_modules') && !filePath.startsWith('bun:')) {
      console.log(`No source map found for ${filePath}`);
    }
    return line;
  }

  const bestMapping = findBestMapping(mappings, originalLine);
  if (!bestMapping) {
    console.log(`No mapping found for line ${originalLine} in ${filePath}`);
    return line;
  }

  const offsetWithinMapping = originalLine - bestMapping.generatedLine;
  const originalLineNumber = bestMapping.originalLine + offsetWithinMapping;

  return line.replace(`:${originalLine}:`, `:${originalLineNumber}:`);
}

// Global flag to prevent infinite recursion
let isTranslatingStackTrace = false;
let translationErrorCount = 0;
const MAX_TRANSLATION_ERRORS = 3;

// Function to translate error stack traces
export function translateStackTrace(error: Error): Error {
  // Prevent infinite recursion and disable after too many failures
  if (isTranslatingStackTrace || !error.stack || translationErrorCount >= MAX_TRANSLATION_ERRORS) {
    return error;
  }

  try {
    isTranslatingStackTrace = true;
    
    const lines = error.stack.split('\n');
    const translatedLines = lines.map(translateSingleStackLine);

    // Try to modify the original error instead of creating a new one
    const originalStack = error.stack;
    try {
      error.stack = translatedLines.join('\n');
      return error;
    } catch (stackModificationError) {
      // If we can't modify the stack, restore original and return as-is
      try {
        error.stack = originalStack;
      } catch {
        // If we can't even restore, just continue with the error as-is
      }
      return error;
    }
      } catch (translationError) {
      translationErrorCount++;
      const errorMessage = translationError instanceof Error ? translationError.message : String(translationError);
      console.warn(`⚠️  Stack trace translation failed (${translationErrorCount}/${MAX_TRANSLATION_ERRORS}):`, errorMessage);
    
    // If we've failed too many times, disable translation
    if (translationErrorCount >= MAX_TRANSLATION_ERRORS) {
      console.warn('🚫 Stack trace translation disabled due to repeated failures');
    }
    
    return error;
  } finally {
    isTranslatingStackTrace = false;
  }
}

function wrapTestFunction(): void {
  if (!globalThis.test || globalThis.originalTest) return;

  console.log('🛡️  Setting up test error boundaries...');

  globalThis.originalTest = globalThis.test;
  globalThis.test = function (name: string, fn: () => void | Promise<void>) {
    if (!globalThis.originalTest) {
      throw new Error('Original test function is undefined');
    }

    return globalThis.originalTest(name, async () => {
      try {
        await fn();
      } catch (error) {
        if (error instanceof Error) {
          try {
            const translated = translateStackTrace(error);
            throw translated;
          } catch (translationError) {
            // If translation fails, throw the original error
            throw error;
          }
        }
        throw error;
      }
    });
  };

  console.log('🛡️  Test error boundaries activated with source map translation!');
}

function setupProcessErrorHandlers(): void {
  process.removeAllListeners('uncaughtException');
  process.removeAllListeners('unhandledRejection');

  process.on('uncaughtException', (error) => {
    try {
      const translated = translateStackTrace(error);
      console.error('❌ Uncaught Exception:', translated);
    } catch (translationError) {
      console.error('❌ Uncaught Exception (translation failed):', error);
    }
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    try {
      if (reason instanceof Error) {
        const translated = translateStackTrace(reason);
        console.error('❌ Unhandled Rejection:', translated);
      } else {
        console.error('❌ Unhandled Rejection:', reason);
      }
    } catch (translationError) {
      console.error('❌ Unhandled Rejection (translation failed):', reason);
    }
    process.exit(1);
  });
}

function patchConsoleError(): void {
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    try {
      const translatedArgs = args.map((arg) => {
        if (arg instanceof Error && arg.stack) {
          try {
            return translateStackTrace(arg);
          } catch (translationError) {
            return arg; // Return original error if translation fails
          }
        }
        return arg;
      });
      originalConsoleError.apply(console, translatedArgs);
    } catch (patchError) {
      // Fallback to original console.error if patching fails
      originalConsoleError.apply(console, args);
    }
  };
}

(function setupErrorBoundaries() {
  // Disable error boundaries on macOS due to infinite recursion issues
  if (process.platform === 'darwin') {
    console.log('🍎 Skipping error boundaries on macOS due to compatibility issues');
    return;
  }
  
  try {
    patchConsoleError();
    setupProcessErrorHandlers();
    wrapTestFunction();
  } catch (setupError) {
    console.warn('⚠️  Failed to setup error boundaries:', setupError);
  }
})();

function shouldSkipTransformation(args: { path: string }, content: string): boolean {
  const normalizedPath = args.path.replace(/\\/g, '/');
  return (
    normalizedPath.includes('.spec.') ||
    normalizedPath.includes('/testing/') ||
    content.includes('☢️ NUCLEAR')
  );
}

function extractShebang(content: string): [string, string] {
  if (!content.startsWith('#!')) return ['', content];

  const firstNewline = content.indexOf('\n');
  if (firstNewline === -1) return ['', content];

  return [content.slice(0, firstNewline + 1), content.slice(firstNewline + 1)];
}

interface ImportReplacement {
  original: string;
  replacement: string;
}

function parseImportNames(importStatement: string): [string[], boolean, boolean, boolean] {
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

function createDestructuredReplacement(
  fullMatch: string,
  moduleName: string,
  importNames: string[]
): string {
  const moduleVar = `__moxxy_module_${moduleName.replace(/[^a-zA-Z0-9]/g, '_')}`;
  const individualProxies = importNames
    .map((name) => `const ${name} = __moxxy__(${moduleVar}.${name}, '${name}', import.meta);`)
    .join('\n');

  return `${fullMatch}\n// ☢️ NUCLEAR: Make ${moduleName} injectable\nconst ${moduleVar} = await import('${moduleName}');\n${individualProxies}`;
}

function createDefaultReplacement(
  fullMatch: string,
  moduleName: string,
  importName: string
): string {
  const varName = `__moxxy_${moduleName.replace(/[^a-zA-Z0-9]/g, '_')}`;
  return `${fullMatch}\n// ☢️ NUCLEAR: Make ${moduleName} injectable\nconst ${varName} = __moxxy__(${importName}, '${importName}', import.meta);`;
}

function shouldSkipImport(moduleName: string): boolean {
  return moduleName.startsWith('./') || moduleName.startsWith('../') || moduleName === 'bun';
}

function __varname(moduleName: string): string {
  return `__moxxy_${moduleName.replace(/[^a-zA-Z0-9]/g, '_')}`;
}

function calculateAddedLines(isDestructured: boolean, importNames: string[]): number {
  if (isDestructured) {
    return 2 + importNames.length; // comment + module import + individual proxies
  }
  return 2; // comment + proxy declaration
}

function processImportMatch(
  match: RegExpMatchArray,
  moduleNamesMap: Map<string, string>,
  declaredNuclearVars: Set<string>
): { original: string; code: string; addedLines: number } | null {
  const [fullMatch, importStatement, moduleName] = match;

  if (shouldSkipImport(moduleName)) {
    return null;
  }

  const [importNames, isDestructured] = parseImportNames(importStatement);
  const varName = __varname(moduleName);

  // Store mapping for later replacement
  if (!isDestructured && importNames.length > 0) {
    moduleNamesMap.set(moduleName, importNames[0]);
  }

  // Only add nuclear treatment if we haven't declared this variable yet
  if (declaredNuclearVars.has(varName)) {
    return null;
  }

  declaredNuclearVars.add(varName);

  const addedLines = calculateAddedLines(isDestructured, importNames);
  let replacementCode: string;

  if (isDestructured) {
    replacementCode = createDestructuredReplacement(fullMatch, moduleName, importNames);
  } else {
    const importName = importNames[0] || moduleName;
    replacementCode = createDefaultReplacement(fullMatch, moduleName, importName);
  }

  return {
    original: fullMatch,
    code: replacementCode,
    addedLines,
  };
}

function processImports(
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
    const replacement = processImportMatch(match, moduleNamesMap, declaredNuclearVars);
    if (!replacement) continue;

    generatedLineOffset += replacement.addedLines;
    importReplacements.push({
      original: replacement.original,
      replacement: replacement.code,
    });
  }

  return [importReplacements, moduleNamesMap, generatedLineOffset];
}

function replaceRuntimeUsage(content: string, moduleNamesMap: Map<string, string>): string {
  let transformedContent = content;

  for (const [moduleName, importName] of moduleNamesMap) {
    const varName = `__moxxy_${moduleName.replace(/[^a-zA-Z0-9]/g, '_')}`;

    // Function calls with parentheses
    const functionCallRegex = new RegExp(
      `(?<!\\.)\\b${importName}\\.[a-zA-Z_][a-zA-Z0-9_]*\\s*\\(`,
      'g'
    );

    transformedContent = transformedContent.replace(functionCallRegex, (match) => {
      return match.replace(importName, `(${varName} || ${importName})`);
    });

    // Specific property access
    const specificProps = ['env', 'argv', 'cwd', 'version', 'platform'];
    for (const prop of specificProps) {
      const propRegex = new RegExp(`(?<!\\.)\\b${importName}\\.${prop}\\b`, 'g');
      transformedContent = transformedContent.replace(propRegex, () => {
        return `(${varName} || ${importName}).${prop}`;
      });
    }
  }

  return transformedContent;
}

function createSourceMap(
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

function setupMoxxy(): string {
  const moxxyCwd = process.cwd().replace(/\\/g, '/'); // Normalize to forward slashes for import paths
  return `// Love, Moxxy ~<3
const { $ } = await import('${moxxyCwd}/src/testing/moxxy.ts');
const __registered = $(import.meta); // Register this module for nuclear injection

// Import the proxy helper
const { __moxxy__ } = await import('${moxxyCwd}/src/testing/moxxy.ts');

`;
}

// Register as Bun plugin for automatic transformation
plugin({
  name: 'Moxxy Dependency Injection',
  setup(build) {
    build.onLoad({ filter: /[\/\\]src[\/\\].*\.ts$/ }, async (args) => {
      const content = await Bun.file(args.path).text();

      if (shouldSkipTransformation(args, content)) {
        return {
          contents: content,
          loader: 'tsx',
        };
      }

      const [shebang, contentToTransform] = extractShebang(content);
      const [importReplacements, moduleNamesMap, generatedLineOffset] =
        processImports(contentToTransform);

      // Apply import transformations
      let transformedContent = contentToTransform;
      for (const replacement of importReplacements) {
        transformedContent = transformedContent.replace(
          replacement.original,
          replacement.replacement
        );
      }

      // Replace direct usage with moxxy proxies
      transformedContent = replaceRuntimeUsage(transformedContent, moduleNamesMap);

      // Create source map
      createSourceMap(shebang, contentToTransform, args, generatedLineOffset);

      // Combine all parts
      const moxxyLines = setupMoxxy();
      const finalContent = shebang + moxxyLines + transformedContent;

      return {
        contents: finalContent,
        loader: 'tsx',
      };
    });
  },
});
