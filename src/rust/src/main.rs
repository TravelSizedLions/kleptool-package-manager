use kleptool_rust::*;

fn main() {
    hello();
    good_bye();
    println!("From WASM: {}", wasm_hello());
    println!("2 + 3 = {}", wasm_add(2, 3));
} 