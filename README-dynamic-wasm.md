# Dynamic Function Discovery for Rust WebAssembly

This project demonstrates how to use a dynamic function registry in Rust to enable calling any registered function by name from TypeScript, without having to write dedicated wrapper functions for each one.

## How It Works

### Rust Side

The Rust WebAssembly module uses a dynamic function registry system:

1. **Single Entry Point**: A single `request` function is exposed to JavaScript
2. **Function Registry**: Functions are registered in a HashMap, mapping names to function pointers
3. **Dynamic Dispatch**: The request function looks up the target function by name and calls it
4. **Automatic Serialization**: Parameters and return values are automatically serialized/deserialized

```rust
// Our global function registry
static FUNCTION_REGISTRY: Lazy<Mutex<HashMap<String, DynFunction>>> = Lazy::new(|| {
    let mut map = HashMap::new();
    register_builtin_functions(&mut map);
    Mutex::new(map)
});

// The main entry point - this is what JS calls
#[wasm_bindgen]
pub fn request(json_request: &str) -> String {
    match serde_json::from_str::<Request>(json_request) {
        Ok(req) => {
            // Look up the function in our registry
            let registry = FUNCTION_REGISTRY.lock().unwrap();
            match registry.get(&req.function) {
                Some(func) => func(&serde_json::to_string(&req.params).unwrap_or_default()),
                None => create_error_response(format!("Function '{}' not found", req.function)),
            }
        },
        Err(e) => create_error_response(format!("Failed to parse request: {}", e)),
    }
}
```

### TypeScript Side

The TypeScript bridge provides a simple, functional interface:

1. **Direct Function Calls**: `wasmBridge.call<T>(functionName, params)`
2. **Type-Safe Function Creators**: `wasmBridge.callable<TParams, TResult>(functionName)`

```typescript
// Call a function directly
const sum = await wasmBridge.call<number>('add', { a: 40, b: 2 });

// Create a type-safe function
const runTask = wasmBridge.callable<
  { name: string, args: string },
  { success: boolean, message: string, duration_ms: number }
>('run_task');

// Use the typed function
const result = await runTask({ name: 'build', args: '--release' });
```

## Benefits

1. **Add Functions Without Changing Bindings**: Just register new functions in Rust, no need to update TypeScript
2. **Type Safety**: TypeScript generics provide strong typing
3. **Reflection-Like Behavior**: Call functions by name at runtime
4. **Consistent Error Handling**: All functions use the same error handling pattern
5. **Clean Separation**: TypeScript doesn't need to know the implementation details of Rust functions

## Adding New Functions

To add a new function, simply register it in the `register_builtin_functions` function:

```rust
registry.insert(
    "my_new_function".to_string(),
    Box::new(|params_json: &str| {
        #[derive(Deserialize)]
        struct Params {
            // Define your parameter structure
            param1: String,
            param2: i32,
        }
        
        match serde_json::from_str::<Params>(params_json) {
            Ok(params) => {
                // Your function implementation here
                let result = format!("Processed: {}", params.param1);
                create_success_response(result)
            },
            Err(e) => create_error_response(format!("Invalid parameters: {}", e)),
        }
    }),
);
```

Then call it from TypeScript:

```typescript
const result = await wasmBridge.call<string>(
    'my_new_function', 
    { param1: 'hello', param2: 42 }
);
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
   
   // Call any registered Rust function
   const result = await wasmBridge.call('function_name', { param1: 'value1' });
   ```

## Future Enhancements

- Add macro support for easier function registration
- Support for streaming data between Rust and TypeScript
- Add automatic type conversion for common types
- Create a plugin system to dynamically load new functions 