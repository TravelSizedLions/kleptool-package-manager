import { BunPlugin } from 'bun';
import * as ts from 'typescript';

export const nuclearDependencyInjectionPlugin: BunPlugin = {
  name: 'nuclear-dependency-injection',
  setup(build) {
    // Transform TypeScript files to inject dependency injection
    build.onLoad({ filter: /\.ts$/ }, async (args) => {
      // Skip test files and the mod system itself
      if (args.path.includes('.spec.') || args.path.includes('testing/')) {
        return;
      }

      const source = await Bun.file(args.path).text();
      const transformed = transformForDependencyInjection(source, args.path);
      
      return {
        contents: transformed,
        loader: 'ts',
      };
    });
  },
};

function transformForDependencyInjection(source: string, filePath: string): string {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true
  );

  const imports: Array<{
    moduleSpecifier: string;
    importClause: string;
    localName: string;
    isDefault: boolean;
    isNamespace: boolean;
  }> = [];

  // Extract all import statements
  function extractImports(node: ts.Node) {
    if (ts.isImportDeclaration(node)) {
      const moduleSpecifier = (node.moduleSpecifier as ts.StringLiteral).text;
      
      if (node.importClause) {
        // Default import: import foo from 'bar'
        if (node.importClause.name) {
          imports.push({
            moduleSpecifier,
            importClause: `import ${node.importClause.name.text} from '${moduleSpecifier}'`,
            localName: node.importClause.name.text,
            isDefault: true,
            isNamespace: false,
          });
        }

        // Named/namespace imports
        if (node.importClause.namedBindings) {
          if (ts.isNamespaceImport(node.importClause.namedBindings)) {
            // import * as foo from 'bar'
            const name = node.importClause.namedBindings.name.text;
            imports.push({
              moduleSpecifier,
              importClause: `import * as ${name} from '${moduleSpecifier}'`,
              localName: name,
              isDefault: false,
              isNamespace: true,
            });
          } else if (ts.isNamedImports(node.importClause.namedBindings)) {
            // import { a, b } from 'bar'
            const elements = node.importClause.namedBindings.elements
              .map(el => el.name.text)
              .join(', ');
            imports.push({
              moduleSpecifier,
              importClause: `import { ${elements} } from '${moduleSpecifier}'`,
              localName: `{${elements}}`,
              isDefault: false,
              isNamespace: false,
            });
          }
        }
      }
    }

    ts.forEachChild(node, extractImports);
  }

  extractImports(sourceFile);

  if (imports.length === 0) {
    return source;
  }

  // Generate the transformed source
  let transformed = source;

  // Add the nuclear injection import at the top
  const injectionImport = `import { $, __createModuleProxy } from '../testing/mod.ts';\n`;
  
  // Replace each import with a proxied version
  for (const imp of imports) {
    const originalImport = imp.importClause;
    
    if (imp.isDefault) {
      // Transform: import foo from 'bar' 
      // To: import __foo_original from 'bar'; const foo = __createModuleProxy(__foo_original, 'foo');
      const proxyCode = `import __${imp.localName}_original from '${imp.moduleSpecifier}';\nconst ${imp.localName} = __createModuleProxy(__${imp.localName}_original, '${imp.localName}', import.meta);`;
      transformed = transformed.replace(originalImport, proxyCode);
    } else if (imp.isNamespace) {
      // Transform: import * as foo from 'bar'
      // To: import * as __foo_original from 'bar'; const foo = __createModuleProxy(__foo_original, 'foo');
      const proxyCode = `import * as __${imp.localName}_original from '${imp.moduleSpecifier}';\nconst ${imp.localName} = __createModuleProxy(__${imp.localName}_original, '${imp.localName}', import.meta);`;
      transformed = transformed.replace(originalImport, proxyCode);
    } else {
      // Named imports are trickier - we need to destructure from a proxy
      const elements = imp.localName.slice(1, -1); // Remove { }
      const proxyCode = `import * as __${imp.moduleSpecifier.replace(/[^a-zA-Z0-9]/g, '_')}_original from '${imp.moduleSpecifier}';\nconst { ${elements} } = __createModuleProxy(__${imp.moduleSpecifier.replace(/[^a-zA-Z0-9]/g, '_')}_original, '${imp.moduleSpecifier}', import.meta);`;
      transformed = transformed.replace(originalImport, proxyCode);
    }
  }

  // Add nuclear registration at the end
  transformed += `\n\n// Nuclear dependency injection registration\n$(import.meta);\n`;

  return injectionImport + transformed;
}

export default nuclearDependencyInjectionPlugin; 