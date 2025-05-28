use web_assembly::*;

fn main() {
    // Basic test of the WebAssembly functionality
    println!("WebAssembly test");
    
    // Example JSON request
    let request_json = r#"{"function":"math.add","params":{"a":5,"b":7}}"#;
    let response = request(request_json);
    println!("5 + 7 = {}", response);
    
    // List available functions
    let list_request = r#"{"function":"list_functions","params":{}}"#;
    let functions = request(list_request);
    println!("Available functions: {}", functions);
} 