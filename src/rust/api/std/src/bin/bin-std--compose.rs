use gud_common::{debug_log, ipc_main_no_input};
use serde::Serialize;

#[derive(Serialize)]
struct ComposeInfo {
  available_functions: Vec<String>,
  version: String,
  description: String,
}

fn get_compose_info() -> Result<ComposeInfo, Box<dyn std::error::Error>> {
  debug_log("Getting composition function information");

  Ok(ComposeInfo {
    available_functions: vec![
      "map".to_string(),
      "filter".to_string(),
      "reduce".to_string(),
      "compose".to_string(),
      "pipe".to_string(),
    ],
    version: "0.1.0".to_string(),
    description: "Functional composition utilities".to_string(),
  })
}

// Use the no-input macro since this doesn't need any input
ipc_main_no_input!(get_compose_info);
