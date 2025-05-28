use proc_macro::TokenStream;
use quote::quote;
use syn::{parse_macro_input, DeriveInput};

#[proc_macro_derive(WasmExport)]
pub fn wasm_export(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as DeriveInput);
    let name = &input.ident;
    
    let expanded = quote! {
        #[wasm_bindgen]
        impl #name {
            #[wasm_bindgen(constructor)]
            pub fn new() -> Self {
                Self::default()
            }
            
            #[wasm_bindgen(js_name = toJson)]
            pub fn to_json(&self) -> String {
                serde_json::to_string(self).unwrap_or_default()
            }
            
            #[wasm_bindgen(js_name = fromJson)]
            pub fn from_json(json: &str) -> Result<#name, JsValue> {
                serde_json::from_str(json)
                    .map_err(|e| JsValue::from_str(&format!("Failed to parse JSON: {}", e)))
            }
        }
    };
    
    TokenStream::from(expanded)
} 