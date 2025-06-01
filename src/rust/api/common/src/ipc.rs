use serde::{Deserialize, Serialize};
use std::io::{self, Read};

// Platform-specific imports for file descriptor handling
#[cfg(unix)]
use std::os::fd::FromRawFd;

/// Error type for IPC operations
#[derive(Debug)]
pub enum IpcError {
  /// IO operation failed
  IoError(io::Error),
  /// JSON serialization/deserialization failed
  SerializationError(serde_json::Error),
  /// Invalid input provided to IPC function
  InvalidInput(String),
}

impl From<io::Error> for IpcError {
  fn from(err: io::Error) -> Self {
    Self::IoError(err)
  }
}

impl From<serde_json::Error> for IpcError {
  fn from(err: serde_json::Error) -> Self {
    Self::SerializationError(err)
  }
}

impl std::fmt::Display for IpcError {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    match self {
      Self::IoError(err) => write!(f, "IO error: {err}"),
      Self::SerializationError(err) => write!(f, "Serialization error: {err}"),
      Self::InvalidInput(msg) => write!(f, "Invalid input: {msg}"),
    }
  }
}

impl std::error::Error for IpcError {}

/// Read JSON input from stdin
pub fn read_stdin_json<T>() -> Result<Option<T>, IpcError>
where
  T: for<'de> Deserialize<'de>,
{
  let mut input = String::new();
  io::stdin().read_to_string(&mut input)?;

  if input.trim().is_empty() {
    return Ok(None);
  }

  let parsed: T = serde_json::from_str(&input)?;
  Ok(Some(parsed))
}

/// Read raw string input from stdin
pub fn read_stdin_raw() -> Result<String, IpcError> {
  let mut input = String::new();
  io::stdin().read_to_string(&mut input)?;
  Ok(input)
}

/// Write JSON output to file descriptor 3
pub fn write_fd3_json<T>(data: &T) -> Result<(), IpcError>
where
  T: Serialize,
{
  let json = serde_json::to_string(data)?;
  write_fd3_raw(&json)
}

/// Write raw string output to file descriptor 3
pub fn write_fd3_raw(data: &str) -> Result<(), IpcError> {
  #[cfg(unix)]
  unsafe {
    use std::io::Write;
    let mut fd3 = std::fs::File::from_raw_fd(3);
    fd3.write_all(data.as_bytes())?;
    fd3.flush()?;
    // Don't let the file be dropped and closed
    std::mem::forget(fd3);
  }

  #[cfg(windows)]
  {
    // On Windows, we'll use stdout as a fallback since fd3 doesn't exist
    // In a real Windows environment, you might want to use named pipes or other IPC mechanisms
    use std::io::Write;
    std::io::stdout().write_all(data.as_bytes())?;
    std::io::stdout().flush()?;
  }

  Ok(())
}

/// High-level handler function that reads JSON from stdin, processes it, and writes JSON to fd3
pub fn handle_json_ipc<I, O, F>(processor: F) -> Result<(), IpcError>
where
  I: for<'de> Deserialize<'de>,
  O: Serialize,
  F: FnOnce(Option<I>) -> Result<O, Box<dyn std::error::Error>>,
{
  // Read input from stdin
  let input: Option<I> = read_stdin_json()?;

  // Process the input
  let output = processor(input).map_err(|e| IpcError::InvalidInput(e.to_string()))?;

  // Write output to fd3
  write_fd3_json(&output)?;

  Ok(())
}

/// Simpler handler for functions that don't need input
pub fn handle_no_input_ipc<O, F>(processor: F) -> Result<(), IpcError>
where
  O: Serialize,
  F: FnOnce() -> Result<O, Box<dyn std::error::Error>>,
{
  handle_json_ipc(|_: Option<()>| processor())
}

/// Handler for functions that always expect input
pub fn handle_required_input_ipc<I, O, F>(processor: F) -> Result<(), IpcError>
where
  I: for<'de> Deserialize<'de>,
  O: Serialize,
  F: FnOnce(I) -> Result<O, Box<dyn std::error::Error>>,
{
  handle_json_ipc(|input: Option<I>| {
    let input = input.ok_or("Input is required but was not provided")?;
    processor(input)
  })
}

/// Debug helper - write to stderr for debugging without interfering with fd3
pub fn debug_log(message: &str) {
  eprintln!("[DEBUG] {message}");
}

/// Macro to create a simple main function with IPC handling
#[macro_export]
macro_rules! ipc_main {
  ($processor:expr) => {
    fn main() {
      if let Err(e) = gud_common::handle_json_ipc($processor) {
        gud_common::debug_log(&format!("IPC error: {}", e));
        std::process::exit(1);
      }
    }
  };
}

/// Macro for no-input handlers
#[macro_export]
macro_rules! ipc_main_no_input {
  ($processor:expr) => {
    fn main() {
      if let Err(e) = gud_common::handle_no_input_ipc($processor) {
        gud_common::debug_log(&format!("IPC error: {}", e));
        std::process::exit(1);
      }
    }
  };
}

/// Macro for required-input handlers
#[macro_export]
macro_rules! ipc_main_required_input {
  ($processor:expr) => {
    fn main() {
      if let Err(e) = gud_common::handle_required_input_ipc($processor) {
        gud_common::debug_log(&format!("IPC error: {}", e));
        std::process::exit(1);
      }
    }
  };
}
