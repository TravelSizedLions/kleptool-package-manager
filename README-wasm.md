# TypeScript + Rust WebAssembly Integration - Functional Style

This example shows how to integrate Rust code with TypeScript using WebAssembly (WASM) in a clean, functional programming style.

## Structure

- `src/rust/wasm_module/` - Rust code that compiles to WebAssembly
- `src/ts/wasm-bridge.ts` - Functional TypeScript bridge to interact with Rust WASM
- `src/ts/wasm-example.ts` - Example usage of the WASM bridge

## The Functional Approach

This integration uses a functional programming style:

1. **Rust exposes a single function**: `request(json_string)` that acts as a dispatcher
2. **TypeScript provides pure functions**:
   - `callWasm<T>(functionName, params)` - Core function to call any Rust function
   - `createWasmCaller<TParams, TResult>(functionName)` - Factory function to create type-safe callers

Benefits:
- **Pure Functions**: No classes, state is minimized and contained
- **Composable**: Easy to combine and extend
- **Strongly Typed**: TypeScript generics provide excellent type safety
- **Minimal Maintenance**: Add new Rust functions without modifying existing code

## Prerequisites

- Rust toolchain (https://rustup.rs/)
- wasm-pack (https://rustwasm.github.io/wasm-pack/installer/)
- Node.js and npm/yarn

## How to Build

1. Install wasm-pack if you haven't:
   ```
   cargo install wasm-pack
   ```

2. Run the build script:
   ```
   chmod +x wasm-build.sh
   ./wasm-build.sh
   ```

## How It Works

1. **Rust Side**:
   - A single `request(json_string)` function takes a JSON string containing:
     - `function`: The name of the Rust function to call
     - `params`: The parameters to pass to the function
   - The dispatcher routes to the appropriate handler function
   - Each handler returns a standardized response

2. **TypeScript Side**:
   - Pure functions with no side effects
   - Minimal state (just a module loading promise)
   - Factory functions to create type-safe callers
   - Composition over inheritance

## Example Usage

```typescript
import { callWasm, createWasmCaller } from './wasm-bridge.js';

// Option 1: Direct call using the generic function
const result = await callWasm<number>('add', { a: 40, b: 2 });

// Option 2: Create a type-safe function caller
const addNumbers = createWasmCaller<
  { a: number, b: number }, // Input type
  number                    // Return type
>('add');

// Use the typed function
const sum = await addNumbers({ a: 40, b: 2 });
```

## Implementation Details

### TypeScript Side (Functional)

```typescript
// Core function to call any Rust function
export const callWasm = async <T>(functionName: string, params: any): Promise<T> => {
  const module = await getModule();
  
  const request = {
    function: functionName,
    params
  };
  
  const responseJson = module.request(JSON.stringify(request));
  const response = JSON.parse(responseJson);
  
  if (!response.success) {
    throw new Error(response.error || 'Unknown error');
  }
  
  return response.result as T;
};

// Create a type-safe function caller
export const createWasmCaller = <TParams, TResult>(functionName: string) => {
  return (params: TParams): Promise<TResult> => {
    return callWasm<TResult>(functionName, params);
  };
};

// Pre-configured functions with proper types
export const addNumbers = createWasmCaller<{a: number, b: number}, number>('add');
```

## Functional Programming Benefits

1. **Immutability**: Pure functions don't modify state
2. **No Side Effects**: Functions only depend on their inputs
3. **Composability**: Easy to combine functions into more complex operations
4. **Testability**: Pure functions are easier to test
5. **Clarity**: Each function has a single responsibility

## Resources

- [wasm-bindgen Guide](https://rustwasm.github.io/docs/wasm-bindgen/)
- [Rust and WebAssembly Book](https://rustwasm.github.io/docs/book/)
- [wasm-pack Documentation](https://rustwasm.github.io/docs/wasm-pack/) 