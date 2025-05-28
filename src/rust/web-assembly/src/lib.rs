use wasm_bindgen::prelude::*;
use serde::{Serialize, Deserialize};
use std::collections::HashMap;
use std::sync::Mutex;
use once_cell::sync::Lazy;

// Re-export the procedural macros
pub use web_assembly_macros::*;

// Type for function pointers that can be stored in our registry
pub type DynFunction = Box<dyn Fn(&str) -> String + Send + Sync + 'static>;

// Our global function registry
static FUNCTION_REGISTRY: Lazy<Mutex<HashMap<String, DynFunction>>> = Lazy::new(|| {
    let mut map = HashMap::new();
    
    // Register built-in functions - these will be supplemented by automatic registration
    register_builtin_functions(&mut map);
    
    Mutex::new(map)
});

// Request structure - what comes in from TypeScript
#[derive(Deserialize)]
struct Request {
  function: String,
  params: serde_json::Value,
}

// Response structure - what goes back to TypeScript
#[derive(Serialize)]
struct Response {
  success: bool,
  result: serde_json::Value,
  error: Option<String>,
}

// The main entry point - this is what JS calls
#[wasm_bindgen]
pub fn request(json_request: &str) -> String {
    match serde_json::from_str::<Request>(json_request) {
        Ok(req) => {
            // Look up the function in our registry
            let registry = FUNCTION_REGISTRY.lock().unwrap();
            match registry.get(&req.function) {
                Some(func) => {
                    // Call the function with the params as a JSON string
                    func(&serde_json::to_string(&req.params).unwrap_or_default())
                },
                None => create_error_response(format!("Function '{}' not found", req.function)),
            }
        },
        Err(e) => create_error_response(format!("Failed to parse request: {}", e)),
    }
}

// Helper to create error responses
pub fn create_error_response(message: String) -> String {
    serde_json::to_string(&Response {
        success: false,
        result: serde_json::Value::Null,
        error: Some(message),
    }).unwrap_or_else(|_| String::from(r#"{"success":false,"result":null,"error":"Failed to serialize error response"}"#))
}

// Helper to create success responses
pub fn create_success_response<T: Serialize>(result: T) -> String {
    match serde_json::to_string(&Response {
        success: true,
        result: serde_json::to_value(result).unwrap_or(serde_json::Value::Null),
        error: None,
    }) {
        Ok(json) => json,
        Err(_) => String::from(r#"{"success":false,"result":null,"error":"Failed to serialize success response"}"#),
    }
}

// Register built-in functions
fn register_builtin_functions(registry: &mut HashMap<String, DynFunction>) {
    // Add a special function to list all available functions
    registry.insert(
        "list_functions".to_string(),
        Box::new(|_params_json: &str| {
            let registry = FUNCTION_REGISTRY.lock().unwrap();
            let function_names: Vec<String> = registry.keys().cloned().collect();
            create_success_response(function_names)
        }),
    );
}

// Register a function at runtime (used by the procedural macros)
pub fn register_function_at_runtime(name: &str, func: DynFunction) {
    FUNCTION_REGISTRY.lock().unwrap().insert(name.to_string(), func);
}

// Initialize function that's called when the module is loaded
#[wasm_bindgen(start)]
pub fn start() {
    // This will be called automatically when the Wasm module is instantiated
    // All functions with #[wasm_export] will also register themselves at this time
}

// Example module with automatically registered functions
#[register_wasm_module]
pub mod math {
    use serde::{Serialize, Deserialize};
    use super::wasm_export;
    
    #[derive(Deserialize)]
    struct AddParams {
        a: i32,
        b: i32,
    }
    
    #[wasm_export]
    pub fn add(params: AddParams) -> i32 {
        params.a + params.b
    }
    
    #[derive(Deserialize)]
    struct MultiplyParams {
        a: i32,
        b: i32,
    }
    
    #[wasm_export]
    pub fn multiply(params: MultiplyParams) -> i32 {
        params.a * params.b
    }
}

// Example of renamed export
#[wasm_export(name = "calculate_power")]
pub fn power(params: serde_json::Value) -> i32 {
    let base: i32 = params.get("base").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
    let exponent: i32 = params.get("exponent").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
    
    let mut result = 1;
    for _ in 0..exponent {
        result *= base;
    }
    result
}

// Task module with automatic registration
#[register_wasm_module]
pub mod tasks {
    use serde::{Serialize, Deserialize};
    use super::wasm_export;
    
    #[derive(Deserialize)]
    pub struct TaskParams {
        name: String,
        args: String,
    }
    
    #[derive(Serialize)]
    pub struct TaskResult {
        success: bool,
        message: String,
        duration_ms: u32,
    }
    
    #[wasm_export]
    pub fn run_task(params: TaskParams) -> TaskResult {
        TaskResult {
            success: true,
            message: format!("Task '{}' completed with args: {}", params.name, params.args),
            duration_ms: 42, // Simulated execution time
        }
    }
} 