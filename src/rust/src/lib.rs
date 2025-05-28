use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};

// Re-export macros
pub use kleptool_macros::*;

// Export the main functions
pub fn hello() {
    println!("Hello, world!");
}

pub fn good_bye() {
    println!("Goodbye, world!");
}

// Wasm exports
#[wasm_bindgen]
pub fn wasm_hello() -> String {
    "Hello from Rust WASM!".to_string()
}

#[wasm_bindgen]
pub fn wasm_add(a: i32, b: i32) -> i32 {
    a + b
}

// Add more functionality as needed from the original web-assembly/src/lib.rs 