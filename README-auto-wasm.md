# Automatic Function Discovery for Rust WebAssembly

This project demonstrates how to create a Rust WebAssembly module with automatic function discovery and registration using procedural macros.

## How It Works

### Rust Side: Attribute Macros

The system uses Rust's procedural macro system to automatically register functions:

1. **Function Annotation**: Use the `#[wasm_export]` attribute to mark functions that should be exposed to JavaScript
2. **Module Organization**: Group related functions in modules marked with `#[register_wasm_module]`
3. **Automatic Registration**: Functions are automatically registered when the WASM module is loaded
4. **Introspection**: List all available functions using the built-in `list_functions` capability

```rust
#[register_wasm_module]
pub mod math {
    use super::wasm_export;
    
    #[wasm_export]
    pub fn add(params: AddParams) -> i32 {
        params.a + params.b
    }
    
    #[wasm_export(name = "custom_name")]
    pub fn multiply(params: MultiplyParams) -> i32 {
        params.a * params.b
    }
}
```

### TypeScript Side: Clean API

The TypeScript bridge provides a simple, functional interface:

```typescript
// Call any registered function directly
const sum = await wasmBridge.call<number>('add', { a: 40, b: 2 });

// Create type-safe function wrappers
const runTask = wasmBridge.callable<
  { name: string, args: string },
  { success: boolean, message: string, duration_ms: number }
>('run_task');

// Use the typed function
const result = await runTask({ name: 'build', args: '--release' });
```

## Benefits

1. **Zero Boilerplate**: No need to manually register functions or update bindings
2. **Automatic Type Safety**: Parameters and return values are automatically validated
3. **Discoverability**: List all available functions at runtime
4. **Naming Control**: Use `name` parameter to control the export name
5. **Organized Code**: Group related functions in modules
6. **Error Handling**: Consistent error handling for all functions

## Adding New Functions

To add a new Rust function that's accessible from JavaScript:

1. Add the `#[wasm_export]` attribute to your function
2. Make sure your function takes a single parameter with `Deserialize` trait
3. Return a value that implements the `Serialize` trait
4. Rebuild the WASM module

```rust
#[wasm_export]
pub fn my_new_function(params: MyParams) -> MyResult {
    // Implementation
}
```

Then call it from TypeScript:

```typescript
const result = await wasmBridge.call<MyResult>('my_new_function', { 
    param1: 'hello', 
    param2: 42 
});
```

## Building and Running

1. **Build the Rust WebAssembly module**:
   ```
   cd src/rust/web-assembly
   wasm-pack build --target web
   ```

2. **Use in TypeScript**:
   ```typescript
   import wasmBridge from './wasm-bridge.js';
   
   // See all available functions
   const functions = await wasmBridge.call<string[]>('list_functions', {});
   console.log('Available functions:', functions);
   
   // Call any function by name
   const result = await wasmBridge.call('function_name', { param1: 'value1' });
   ```

## Implementation Details

The automatic registration system uses procedural macros to:

1. Process function definitions at compile time
2. Generate registration code for each annotated function
3. Create self-registering wrappers that run during module initialization
4. Provide consistent parameter parsing and error handling

This approach combines the performance and safety of Rust with the flexibility of dynamic languages like JavaScript. 