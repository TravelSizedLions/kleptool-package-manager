pub mod toy_utils;
pub use toy_utils::*;

use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn subtract(a: i32, b: i32) -> i32 {
  add(a, -b)
}
