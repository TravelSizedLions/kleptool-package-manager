// Import the wasm-bindgen generated TypeScript bindings
// The path will be to the generated JavaScript file after building
// In real use, you would import from the built path
// import * as wasm from '../rust/wasm_module/pkg/wasm_module.js';

// This is a placeholder until the WASM module is built
// In a real application, this would be replaced with the actual import
type WasmModule = {
  request: (jsonRequest: string) => string;
}

// TypeScript types for requests and responses
interface WasmRequest {
  function: string;
  params: any;
}

interface WasmResponse {
  success: boolean;
  result: any;
  error?: string;
}

/**
 * Module loading state
 */
let modulePromise: Promise<WasmModule> | null = null;

/**
 * Get or initialize the WASM module
 */
const getModule = async (): Promise<WasmModule> => {
  if (!modulePromise) {
    modulePromise = import('../rust/web-assembly/pkg/web_assembly.js');
  }
  
  return modulePromise as Promise<WasmModule>;
};

/**
 * Call a function in the Rust WASM module
 * 
 * @param functionName - The name of the Rust function to call
 * @param params - Parameters to pass to the function
 * @returns A promise that resolves to the result
 */
const call = async <T>(functionName: string, params: any): Promise<T> => {
  const module = await getModule();
  
  // Create the request object
  const request: WasmRequest = {
    function: functionName,
    params
  };
  
  // Call the Rust request function with our serialized request
  const responseJson = module.request(JSON.stringify(request));
  
  // Parse the response
  const response: WasmResponse = JSON.parse(responseJson);
  
  // Handle errors
  if (!response.success) {
    throw new Error(response.error || 'Unknown error from WASM module');
  }
  
  // Return the result
  return response.result as T;
};

/**
 * Utility function to create specific WASM function callers with type safety
 * 
 * @param functionName - The name of the Rust function
 * @returns A function that calls the specified Rust function
 */
const callable = <TParams, TResult>(functionName: string) => {
  return (params: TParams): Promise<TResult> => {
    return call<TResult>(functionName, params);
  };
}; 

export default {
  call,
  callable
}