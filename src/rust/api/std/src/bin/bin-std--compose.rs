#![allow(missing_docs)]

use gud_common::{debug_log, ipc_main_no_input};
use serde::Serialize;

#[derive(Serialize)]
struct ComposeInfo {
  version: String,
  available_functions: Vec<String>,
}

#[allow(clippy::unnecessary_wraps)]
fn get_compose_info() -> Result<ComposeInfo, Box<dyn std::error::Error>> {
  debug_log("Getting compose function information");

  Ok(ComposeInfo {
    version: "0.1.0".to_string(),
    available_functions: vec![
      "map".to_string(),
      "filter".to_string(),
      "reduce".to_string(),
    ],
  })
}

// Use the no-input macro since this doesn't need any input
ipc_main_no_input!(get_compose_info);
