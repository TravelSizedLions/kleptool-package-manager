pub mod toy_utils;
pub use toy_utils::*;

use wasm_bindgen::prelude::*;
use serde::{Serialize, Deserialize};

#[derive(Serialize, Deserialize)]
pub struct Command {
    pub action: String,
    pub a: i32,
    pub b: i32,
}

#[wasm_bindgen]
pub fn subtract(a: i32, b: i32) -> i32 {
  add(a, -b)
}

#[wasm_bindgen]
pub fn make_command(action: &str, a: i32, b: i32) -> String {
    let cmd = Command {
        action: action.to_string(),
        a,
        b,
    };
    serde_json::to_string(&cmd).unwrap()
}
