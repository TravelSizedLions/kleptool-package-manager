import { plugin } from 'bun';

// Don't create a separate injector - use the main testing system
export { __moduleRegistry, __mockRegistry } from './mod.ts';

// Register as Bun plugin for automatic transformation
plugin({
  name: 'Nuclear Dependency Injection',
  setup(build) {
    console.log('☢️ Nuclear plugin activated - dependencies will be proxied!');
    
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
      
      if (args.path.includes('keepfile')) {
        console.log(`⚡ Transforming: ${args.path}`);
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
        
        if (moduleName.includes('node:')) {
          console.log(`🔬 Found import: ${importStatement} from ${moduleName}`);
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
          } else {
            // For default/namespace imports
            const importName = importNames[0];
            replacementCode = `${fullMatch}\n// ☢️ NUCLEAR: Make ${moduleName} injectable\nconst ${varName} = __createModuleProxy(${importName}, '${importName}', import.meta);`;
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
            if (importName === 'fs') {
              console.log(`🔄 Replacing ${importName} function calls: ${match} -> ${match.replace(importName, `(${varName} || ${importName})`)}`);
            }
            return match.replace(importName, `(${varName} || ${importName})`);
          });
          
          // Pattern 2: Very specific property access (only common runtime properties)
          // Only replace things like process.env, process.argv, process.cwd
          const specificProps = ['env', 'argv', 'cwd', 'version', 'platform'];
          for (const prop of specificProps) {
            const propRegex = new RegExp(`(?<!\\.)\\b${importName}\\.${prop}\\b`, 'g');
            transformedContent = transformedContent.replace(propRegex, (match) => {
              // console.log(`🔄 Replacing ${importName}.${prop} with (${varName} || ${importName}).${prop}`);
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
      
      // Combine shebang + nuclear setup + transformed content
      const finalContent = shebang + nuclearSetup + transformedContent;
      
      return {
        contents: finalContent,
        loader: 'tsx'
      };
    });
  }
}); 