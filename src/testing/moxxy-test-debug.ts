// Debug script to test moxxy transformer regex

const content = `
import defaultFunction from './moxxy-test-module.ts';
import { namedFunction, namedConstant, testObject, TestClass, namespace } from './moxxy-test-module.ts';
`;

console.log('Testing import regex:');

const importRegex = /^import\s+(?!type\s)([^'"]*)\s+from\s+['"]([^'"]+)['"];?\s*$/gm;
const matches = content.matchAll(importRegex);

for (const match of matches) {
  const [fullMatch, importStatement, moduleName] = match;
  console.log('---');
  console.log('Full match:', fullMatch.trim());
  console.log('Import statement:', importStatement.trim());
  console.log('Module name:', moduleName);
  
  // Test parsing
  const trimmed = importStatement.trim();
  let importNames: string[] = [];
  let isDestructured = false;
  
  if (trimmed.startsWith('{') && trimmed.includes('}')) {
    isDestructured = true;
    const destructuredMatch = trimmed.match(/\{\s*([^}]+)\s*\}/);
    if (destructuredMatch) {
      importNames = destructuredMatch[1].split(',').map((name) => name.trim());
    }
  } else {
    const defaultMatch = trimmed.match(/^(\w+)/);
    if (defaultMatch) {
      importNames = [defaultMatch[1]];
    }
  }
  
  console.log('Is destructured:', isDestructured);
  console.log('Import names:', importNames);
} 