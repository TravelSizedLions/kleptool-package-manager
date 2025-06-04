import js from '@eslint/js';
import typescriptEslint from '@typescript-eslint/eslint-plugin';
import typescriptParser from '@typescript-eslint/parser';
import prettierConfig from 'eslint-config-prettier';
import prettierPlugin from 'eslint-plugin-prettier';

export default [
  js.configs.recommended,
  
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: 2021,
        sourceType: 'module',
      },
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        global: 'readonly',
        module: 'readonly',
        require: 'readonly',
        exports: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        NodeJS: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': typescriptEslint,
      prettier: prettierPlugin,
    },
    rules: {
      // Prettier integration
      'prettier/prettier': 'error',
      
      // TypeScript rules
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/indent': ['error', 2, {
        'SwitchCase': 1,
        'FunctionDeclaration': {
          'parameters': 'first'
        },
        'FunctionExpression': {
          'parameters': 'first'
        }
      }],
      
      // Object formatting rules
      'object-property-newline': 'off',
      'object-curly-newline': 'off',
      'object-curly-spacing': ['error', 'always'],
      
      // Recommended TypeScript rules
      ...typescriptEslint.configs.recommended.rules,
      
      // Allow Function type usage
      '@typescript-eslint/no-unsafe-function-type': 'off',
    },
    settings: {
      '@typescript-eslint': {
        suppressTypeScriptVersionCheck: true,
      },
    },
  },
  
  // Test files configuration - adds global moxxy
  {
    files: ['**/*.spec.ts', '**/*.spec.tsx', '**/*.test.ts', '**/*.test.tsx'],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: 2021,
        sourceType: 'module',
      },
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        global: 'readonly',
        module: 'readonly',
        require: 'readonly',
        exports: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        NodeJS: 'readonly',
        moxxy: 'readonly', // Global moxxy for testing
      },
    },
    plugins: {
      '@typescript-eslint': typescriptEslint,
      prettier: prettierPlugin,
    },
    rules: {
      // Prettier integration
      'prettier/prettier': 'error',
      
      // TypeScript rules
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/indent': ['error', 2, {
        'SwitchCase': 1,
        'FunctionDeclaration': {
          'parameters': 'first'
        },
        'FunctionExpression': {
          'parameters': 'first'
        }
      }],
      
      // Object formatting rules
      'object-property-newline': 'off',
      'object-curly-newline': 'off',
      'object-curly-spacing': ['error', 'always'],
      
      // Recommended TypeScript rules
      ...typescriptEslint.configs.recommended.rules,
      
      // Allow Function type usage
      '@typescript-eslint/no-unsafe-function-type': 'off',
      
      // Allow any types in test files since mocking often requires them
      '@typescript-eslint/no-explicit-any': 'off',
    },
    settings: {
      '@typescript-eslint': {
        suppressTypeScriptVersionCheck: true,
      },
    },
  },
  
  // Apply prettier config to override any conflicting rules
  prettierConfig,
]; 