use proc_macro::TokenStream;
use quote::{quote, format_ident};
use syn::{parse_macro_input, ItemFn, AttributeArgs, NestedMeta, Lit, Meta, MetaNameValue, DeriveInput};

/// A procedural macro that marks a function to be automatically registered
/// with the WebAssembly function registry.
/// 
/// Example:
/// ```
/// #[wasm_export]
/// fn add(a: i32, b: i32) -> i32 {
///     a + b
/// }
/// ```
#[proc_macro_attribute]
pub fn wasm_export(attr: TokenStream, item: TokenStream) -> TokenStream {
    let input = parse_macro_input!(item as ItemFn);
    let attrs = parse_macro_input!(attr as AttributeArgs);
    
    // Extract the function name
    let func_name = &input.sig.ident;
    let func_name_str = func_name.to_string();
    
    // Check for optional name override
    let export_name = attrs.iter().find_map(|nested_meta| {
        if let NestedMeta::Meta(Meta::NameValue(MetaNameValue { path, lit, .. })) = nested_meta {
            if path.is_ident("name") {
                if let Lit::Str(lit_str) = lit {
                    return Some(lit_str.value());
                }
            }
        }
        None
    }).unwrap_or_else(|| func_name_str.clone());
    
    // Generate the registration function name
    let register_func_name = format_ident!("__register_{}", func_name);
    
    // Generate the output code
    let expanded = quote! {
        // Keep the original function
        #input

        // Create a registration function for this function
        #[doc(hidden)]
        #[wasm_bindgen::prelude::wasm_bindgen(start)]
        pub fn #register_func_name() {
            use wasm_bindgen::prelude::*;
            use serde::{Serialize, Deserialize};
            
            // This will be called when the Wasm module is instantiated
            // Register our function with the global registry
            register_function_at_runtime(
                #export_name,
                Box::new(|params_json: &str| {
                    // Parse params
                    match serde_json::from_str(params_json) {
                        Ok(params) => {
                            // Call the actual function
                            match serde_json::from_value(params) {
                                Ok(parsed_params) => {
                                    // Try to call the function and serialize the result
                                    match std::panic::catch_unwind(|| {
                                        let result = #func_name(parsed_params);
                                        create_success_response(result)
                                    }) {
                                        Ok(result) => result,
                                        Err(_) => create_error_response(
                                            format!("Function '{}' panicked during execution", #export_name)
                                        ),
                                    }
                                },
                                Err(e) => create_error_response(
                                    format!("Failed to parse parameters for {}: {}", #export_name, e)
                                ),
                            }
                        },
                        Err(e) => create_error_response(
                            format!("Failed to parse JSON for {}: {}", #export_name, e)
                        ),
                    }
                }),
            );
        }
    };
    
    TokenStream::from(expanded)
}

/// A procedural macro that automatically registers all functions in a module.
/// 
/// Example:
/// ```
/// #[register_wasm_module]
/// mod math {
///     #[wasm_export]
///     fn add(a: i32, b: i32) -> i32 {
///         a + b
///     }
///     
///     #[wasm_export]
///     fn multiply(a: i32, b: i32) -> i32 {
///         a * b
///     }
/// }
/// ```
#[proc_macro_attribute]
pub fn register_wasm_module(_attr: TokenStream, item: TokenStream) -> TokenStream {
    // Just pass through the module definition - the individual function macros
    // will handle the registration
    item
}

// WasmExport derive macro for structs
#[proc_macro_derive(WasmExport)]
pub fn wasm_export_derive(input: TokenStream) -> TokenStream {
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