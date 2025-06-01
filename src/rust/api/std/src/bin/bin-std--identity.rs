use gud_common::{debug_log, ipc_main};
use serde_json::Value;

fn identity_function(input: Option<Value>) -> Result<Value, Box<dyn std::error::Error>> {
  debug_log("Running identity function");

  if let Some(value) = input {
    debug_log(&format!("Returning input value: {value}"));
    Ok(value)
  } else {
    debug_log("No input provided, returning null");
    Ok(Value::Null)
  }
}

// Use the generic IPC macro that can handle any JSON value
ipc_main!(identity_function);
