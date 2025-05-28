use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn add(a: i32, b: i32) -> i32 {
  a + b
}

#[wasm_bindgen]
pub fn multiply(a: i32, b: i32) -> i32 {
  a * b
}

#[wasm_bindgen]
pub fn power(a: i32, b: u32) -> i32 {
  a.pow(b)
}
