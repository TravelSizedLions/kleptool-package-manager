import { plugin } from 'bun';

// Global declarations for test function wrapping
declare global {
  var originalTest: any;
  var test: any;
}

// Don't create a separate injector - use the main testing system
export { __moduleRegistry, __mockRegistry } from './mod.ts';

// Interface for source map support
interface SourceMapEntry {
  originalLine: number;
  generatedLine: number;
  source: string;
}

const sourceMapRegistry = new Map<string, SourceMapEntry[]>();

// Function to translate error stack traces
export function translateStackTrace(error: Error): Error {
  if (!error.stack) return error;
  
  const lines = error.stack.split('\n');
  const translatedLines = lines.map(line => {
    const patterns = [
      /\s+at .* \((.+):(\d+):(\d+)\)/, // at function (file:line:col)
      /\s+at (.+):(\d+):(\d+)/, // at file:line:col
      /\s+at <anonymous> \((.+):(\d+):(\d+)\)/ // at <anonymous> (file:line:col)
    ];
    
    let match = null;
    for (const pattern of patterns) {
      match = line.match(pattern);
      if (match) break;
    }
    
    if (!match) return line;
    
    const filePath = match[1];
    const originalLine = parseInt(match[2], 10);
    const column = match[3];
    
    console.log(`🔍 Translating: ${filePath}:${originalLine}`);
    
    // Look up source map for this file
    const mappings = sourceMapRegistry.get(filePath);
    if (!mappings || mappings.length === 0) {
      console.log(`❌ No source map found for ${filePath}`);
      return line;
    }
    
    // Find the correct mapping - look for the entry that contains our generated line
    let bestMapping = null;
    for (const mapping of mappings) {
      if (originalLine >= mapping.generatedLine) {
        bestMapping = mapping;
        break;
      }
    }
    
    if (!bestMapping) {
      console.log(`❌ No mapping found for line ${originalLine} in ${filePath}`);
      return line;
    }
    
    // Calculate the original line number
    const offsetWithinMapping = originalLine - bestMapping.generatedLine;
    const originalLineNumber = bestMapping.originalLine + offsetWithinMapping;
    
    // Replace the line number in the stack trace
    return line.replace(`:${originalLine}:`, `:${originalLineNumber}:`);
  });
  
  // Create new error with translated stack trace
  const translatedError = new Error(error.message);
  translatedError.stack = translatedLines.join('\n');
  translatedError.name = error.name;
  
  // Copy other properties
  Object.assign(translatedError, error);
  
  return translatedError;
}

// Set up error boundaries and automatic stack trace translation
function setupErrorBoundaries() {
  // Monkey-patch console.error to translate stack traces
  const originalConsoleError = console.error;
  console.error = (...args: any[]) => {
    const translatedArgs = args.map(arg => {
      if (arg instanceof Error && arg.stack) {
        const translated = translateStackTrace(arg);
        return translated;
      }
      return arg;
    });
    originalConsoleError.apply(console, translatedArgs);
  };

  // Set up process error handlers with source map translation
  process.removeAllListeners('uncaughtException');
  process.removeAllListeners('unhandledRejection');

  process.on('uncaughtException', (error) => {
    const translated = translateStackTrace(error);
    console.error('❌ Uncaught Exception:', translated);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    if (reason instanceof Error) {
      const translated = translateStackTrace(reason);
      console.error('❌ Unhandled Rejection:', translated);
    } else {
      console.error('❌ Unhandled Rejection:', reason);
    }
    process.exit(1);
  });

  // Wrap test functions for automatic error translation
  if (typeof globalThis.test === 'function' && !globalThis.originalTest) {
    console.log('🛡️  Setting up test error boundaries...');

    globalThis.originalTest = globalThis.test;
    globalThis.test = function(name: string, fn: () => void | Promise<void>) {
      return globalThis.originalTest(name, async () => {
        try {
          await fn();
        } catch (error) {
          if (error instanceof Error) {
            const translated = translateStackTrace(error);
            throw translated;
          }
          throw error;
        }
      });
    };
    
    console.log('🛡️  Test error boundaries activated with source map translation!');
  }
}

// Call setup when this module is loaded
setupErrorBoundaries();

// Register as Bun plugin for automatic transformation
plugin({
  name: 'Nuclear Dependency Injection',
  setup(build) {
    console.log('☢️ Nuclear Reactor Activated');
    
    // ONLY transform our source files - exclude test files entirely
    build.onLoad({ filter: /\/src\/.*\.ts$/ }, async (args) => {
      const content = await Bun.file(args.path).text();
      
      // Skip test files, already transformed files, and testing modules
      if (args.path.includes('.spec.') || 
          args.path.includes('/testing/') ||
          content.includes('☢️ NUCLEAR')) {
        return {
          contents: content,
          loader: 'tsx'
        };
      }
      
      
      // Check for shebang and preserve it
      let shebang = '';
      let contentToTransform = content;
      if (content.startsWith('#!')) {
        const firstNewline = content.indexOf('\n');
        if (firstNewline !== -1) {
          shebang = content.slice(0, firstNewline + 1);
          contentToTransform = content.slice(firstNewline + 1);
        }
      }
      
      // Simple AST-free transformation approach
      let transformedContent = contentToTransform;
      
      // Track source map entries
      const sourceMapEntries: SourceMapEntry[] = [];
      let generatedLineOffset = 0;
      
      // More precise regex that only matches actual import statements at line start
      // This avoids matching imports in comments or strings
      const importMatches = contentToTransform.matchAll(/^import\s+([^'"]*)\s+from\s+['"]([^'"]+)['"];?\s*$/gm);
      const importReplacements = [];
      const declaredNuclearVars = new Set<string>(); // Track declared nuclear variables
      const moduleNamesMap = new Map<string, string>(); // Track module name to import name mapping
      
      for (const match of importMatches) {
        const [fullMatch, importStatement, moduleName] = match;
        
        // Skip internal imports and already transformed
        if (moduleName.startsWith('./') || moduleName.startsWith('../') || moduleName === 'bun') {
          continue;
        }
        
        // Handle different import types
        let importNames: string[] = [];
        let isDestructured = false;
        let isNamespace = false;
        let isDefault = false;
        
        const trimmed = importStatement.trim();
        
        if (trimmed.startsWith('{') && trimmed.includes('}')) {
          // Destructured import: { a, b, c } from 'module'
          isDestructured = true;
          const destructuredMatch = trimmed.match(/\{\s*([^}]+)\s*\}/);
          if (destructuredMatch) {
            importNames = destructuredMatch[1].split(',').map(name => name.trim());
          }
        } else if (trimmed.includes('* as ')) {
          // Namespace import: * as name from 'module'
          isNamespace = true;
          const namespaceMatch = trimmed.match(/\*\s+as\s+(\w+)/);
          if (namespaceMatch) {
            importNames = [namespaceMatch[1]];
          }
        } else {
          // Default import: name from 'module'
          isDefault = true;
          const defaultMatch = trimmed.match(/^(\w+)/);
          if (defaultMatch) {
            importNames = [defaultMatch[1]];
          }
        }
        
        // Create unique variable name for this module
        const varName = `__nuclear_${moduleName.replace(/[^a-zA-Z0-9]/g, '_')}`;
        
        // Store mapping for later replacement  
        if (!isDestructured) {
          // For default/namespace imports, map the import name to module for replacement
          moduleNamesMap.set(moduleName, importNames[0] || moduleName);
        }
        // Destructured imports don't need mapping since the variables are already proxies
        
        // Only add nuclear treatment if we haven't declared this variable yet
        if (!declaredNuclearVars.has(varName)) {
          declaredNuclearVars.add(varName);
          
          let replacementCode;
          if (isDestructured) {
            // For destructured imports, create individual proxies for each function
            const moduleVar = `__nuclear_module_${moduleName.replace(/[^a-zA-Z0-9]/g, '_')}`;
            const individualProxies = importNames.map(name => 
              `const ${name} = __createModuleProxy(${moduleVar}.${name}, '${name}', import.meta);`
            ).join('\n');
            
            replacementCode = `${fullMatch}\n// ☢️ NUCLEAR: Make ${moduleName} injectable\nconst ${moduleVar} = await import('${moduleName}');\n${individualProxies}`;
            
            // Track source map: original import line stays the same, but we're adding lines
            const addedLines = 2 + importNames.length; // comment + module import + individual proxies
            generatedLineOffset += addedLines;
          } else {
            // For default/namespace imports
            const importName = importNames[0];
            replacementCode = `${fullMatch}\n// ☢️ NUCLEAR: Make ${moduleName} injectable\nconst ${varName} = __createModuleProxy(${importName}, '${importName}', import.meta);`;
            
            // Track source map: adding 2 lines (comment + proxy declaration)
            generatedLineOffset += 2;
          }
          
          importReplacements.push({
            original: fullMatch,
            replacement: replacementCode
          });
        }
      }
      
      // Apply import transformations first
      for (const replacement of importReplacements) {
        transformedContent = transformedContent.replace(replacement.original, replacement.replacement);
      }
      
              // Replace direct usage with nuclear proxies - ULTRA CONSERVATIVE!
        for (const [key, importName] of moduleNamesMap) {
          const moduleName = key;
          const varName = `__nuclear_${moduleName.replace(/[^a-zA-Z0-9]/g, '_')}`;
          
          // ONLY replace very specific patterns that are definitely runtime usage
          // Pattern 1: Function calls with parentheses
          // Example: fs.existsSync(...), path.join(...), process.cwd()
          // BUT NOT: entry.path.toString() or obj.fs.method()
          const functionCallRegex = new RegExp(`(?<!\\.)\\b${importName}\\.[a-zA-Z_][a-zA-Z0-9_]*\\s*\\(`, 'g');
          
          transformedContent = transformedContent.replace(functionCallRegex, (match) => {
            return match.replace(importName, `(${varName} || ${importName})`);
          });
          
          // Pattern 2: Very specific property access (only common runtime properties)
          // Only replace things like process.env, process.argv, process.cwd
          const specificProps = ['env', 'argv', 'cwd', 'version', 'platform'];
          for (const prop of specificProps) {
            const propRegex = new RegExp(`(?<!\\.)\\b${importName}\\.${prop}\\b`, 'g');
            transformedContent = transformedContent.replace(propRegex, (match) => {
              return `(${varName} || ${importName}).${prop}`;
            });
          }
        }
      
      // Inject nuclear setup at the top (after shebang if present)
      // This calls $(import.meta) to register with the main testing system
      const nuclearSetup = `// ☢️ NUCLEAR DEPENDENCIES ACTIVATED
const { $ } = await import('${process.cwd()}/src/testing/mod.ts');
const __registered = $(import.meta); // Register this module for nuclear injection

// Import the proxy helper
const { __createModuleProxy } = await import('${process.cwd()}/src/testing/mod.ts');

`;
      
      // The nuclear setup adds 6 lines
      const nuclearSetupLines = 6;
      
      // Create source map entries
      const originalLines = (shebang + contentToTransform).split('\n');
      const shebangLines = shebang ? 1 : 0;
      
      // Map all lines after the nuclear setup
      for (let i = 0; i < originalLines.length; i++) {
        sourceMapEntries.push({
          originalLine: i + 1, // 1-indexed
          generatedLine: i + 1 + shebangLines + nuclearSetupLines + generatedLineOffset,
          source: args.path
        });
      }
      
      // Store source map for this file
      sourceMapRegistry.set(args.path, sourceMapEntries);
      
      // Combine shebang + nuclear setup + transformed content
      const finalContent = shebang + nuclearSetup + transformedContent;
      
      return {
        contents: finalContent,
        loader: 'tsx'
      };
    });
  }
}); 