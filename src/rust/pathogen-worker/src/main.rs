use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::io::{self, BufRead, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::Instant;

#[derive(Debug, Serialize, Deserialize)]
pub enum Language {
  TypeScript,
  Rust,
}

impl Language {
  pub fn get_test_runner_command(&self) -> &'static str {
    match self {
      Language::TypeScript => "bun",
      Language::Rust => "cargo",
    }
  }

  pub fn get_test_args(&self) -> Vec<&'static str> {
    match self {
      Language::TypeScript => vec!["test"],
      Language::Rust => vec!["test"],
    }
  }
}

#[derive(Debug, Serialize, Deserialize)]
struct MutationRequest {
  file_path: String,
  mutated_content: String,
  mutation_id: String,
  workspace_dir: String,
  language: Language,
}

#[derive(Debug, Serialize, Deserialize)]
struct TestResult {
  success: bool,
  output: String,
  execution_time_ms: u64,
  mutation_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
enum WorkerMessage {
  MutationRequest(MutationRequest),
  Shutdown,
}

#[derive(Debug, Serialize, Deserialize)]
enum WorkerResponse {
  TestResult(TestResult),
  Ready,
  Shutdown,
  Error(String),
}

#[tokio::main]
async fn main() -> Result<()> {
  // Send ready signal via fd3
  send_response(WorkerResponse::Ready)?;

  // Listen for mutation requests via stdin
  let stdin = io::stdin();
  for line in stdin.lock().lines() {
    let line = line?;

    match serde_json::from_str::<WorkerMessage>(&line) {
      Ok(WorkerMessage::MutationRequest(request)) => {
        let result = execute_mutation(request).await;
        send_response(WorkerResponse::TestResult(result))?;
      }
      Ok(WorkerMessage::Shutdown) => {
        send_response(WorkerResponse::Shutdown)?;
        break;
      }
      Err(e) => {
        let error_msg = format!("Failed to parse request: {}", e);
        send_response(WorkerResponse::Error(error_msg))?;
      }
    }
  }

  Ok(())
}

async fn execute_mutation(request: MutationRequest) -> TestResult {
  let start_time = Instant::now();
  let workspace_dir = PathBuf::from(&request.workspace_dir);
  let target_file = workspace_dir.join(&request.file_path);

  // Read original content first for restoration
  let original_content = match tokio::fs::read_to_string(&target_file).await {
    Ok(content) => content,
    Err(e) => {
      return TestResult {
        success: false,
        output: format!("FILE_ERROR: Failed to read original file: {}", e),
        execution_time_ms: start_time.elapsed().as_millis() as u64,
        mutation_id: request.mutation_id,
      };
    }
  };

  // Write mutated content to file
  let write_result = tokio::fs::write(&target_file, &request.mutated_content).await;
  if let Err(e) = write_result {
    return TestResult {
      success: false,
      output: format!("FILE_ERROR: Failed to write mutation: {}", e),
      execution_time_ms: start_time.elapsed().as_millis() as u64,
      mutation_id: request.mutation_id,
    };
  }

  // Run targeted tests for massive performance improvement
  let test_output = run_targeted_tests(&workspace_dir, &request.file_path, &request.language).await;

  // CRITICAL: Restore original content after test
  let restore_result = tokio::fs::write(&target_file, &original_content).await;
  if let Err(e) = restore_result {
    eprintln!(
      "WARNING: Failed to restore original content for {}: {}",
      target_file.display(),
      e
    );
  }

  let execution_time_ms = start_time.elapsed().as_millis() as u64;

  match test_output {
    Ok(output) => {
      // Tests completed successfully - check if mutation was killed or survived
      let has_test_matches = !output.contains("had no matches");
      let tests_passed = output.contains("0 fail");

      if !has_test_matches {
        // No matching tests found - mutation SURVIVES because nothing caught it!
        TestResult {
          success: true, // This should be true - mutation survived!
          output: format!("NO_TESTS: {}", output),
          execution_time_ms,
          mutation_id: request.mutation_id,
        }
      } else if tests_passed {
        // Tests passed - mutation survived (bad for test quality)
        TestResult {
          success: true,
          output,
          execution_time_ms,
          mutation_id: request.mutation_id,
        }
      } else {
        // Tests failed - mutation was killed (good for test quality)
        TestResult {
          success: false,
          output,
          execution_time_ms,
          mutation_id: request.mutation_id,
        }
      }
    }
    Err(error) => {
      // Test execution failed - classify the type of failure
      if error.contains("timed out") {
        TestResult {
          success: false,
          output: format!("TIMEOUT: {}", error),
          execution_time_ms,
          mutation_id: request.mutation_id,
        }
      } else if error.contains("Failed to spawn") || error.contains("Failed to get test output") {
        TestResult {
          success: false,
          output: format!("EXECUTION_ERROR: {}", error),
          execution_time_ms,
          mutation_id: request.mutation_id,
        }
      } else {
        // Genuine test failure - mutation was killed
        TestResult {
          success: false,
          output: error,
          execution_time_ms,
          mutation_id: request.mutation_id,
        }
      }
    }
  }
}

async fn run_targeted_tests(
  workspace_dir: &PathBuf,
  mutated_file: &str,
  language: &Language,
) -> Result<String, String> {
  // Implement targeted test selection for massive performance gains
  // Instead of running all 154 tests, only run tests relevant to the mutated file

  let _start = std::time::Instant::now();

  // Determine the target test file based on the mutated file
  let test_file = if let Some(spec_file) = get_target_test_file(mutated_file, language) {
    spec_file
  } else {
    // No specific test file found - this means no tests cover this file
    // Return a "had no matches" result to indicate the mutation should survive
    return Ok("had no matches - no test file found".to_string());
  };

  // Run the specific test file with timeout to prevent infinite loops
  let mut child = Command::new(language.get_test_runner_command());

  // Add language-specific test arguments
  for arg in language.get_test_args() {
    child.arg(arg);
  }

  // Add the test file argument (language-specific handling)
  match language {
    Language::TypeScript => {
      child.arg(&test_file);
    }
    Language::Rust => {
      // For Rust, we'll run specific test functions/modules if possible
      // For now, just run all tests in the workspace
      // TODO: Add more targeted Rust test selection
    }
  }

  let child = child
    .current_dir(workspace_dir)
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .spawn()
    .map_err(|e| format!("Failed to spawn targeted test command: {}", e))?;

  // Set a reasonable timeout (5 seconds for targeted tests)
  let timeout = std::time::Duration::from_secs(5);
  let output = match tokio::time::timeout(timeout, async move { child.wait_with_output() }).await {
    Ok(Ok(output)) => output,
    Ok(Err(e)) => return Err(format!("Failed to get test output: {}", e)),
    Err(_) => {
      return Err(format!(
        "Test timed out after {} seconds (likely infinite loop)",
        timeout.as_secs()
      ));
    }
  };

  if output.status.success() {
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
  } else {
    Err(format!(
      "{}\n{}",
      String::from_utf8_lossy(&output.stdout),
      String::from_utf8_lossy(&output.stderr)
    ))
  }
}

async fn run_full_test_suite(workspace_dir: &PathBuf) -> Result<String, String> {
  // Fallback to full test suite with timeout
  let child = Command::new("klep")
    .arg("ts:test")
    .current_dir(workspace_dir)
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .spawn()
    .map_err(|e| format!("Failed to spawn full test command: {}", e))?;

  // Longer timeout for full test suite (30 seconds)
  let timeout = std::time::Duration::from_secs(30);
  let output = match tokio::time::timeout(timeout, async move { child.wait_with_output() }).await {
    Ok(Ok(output)) => output,
    Ok(Err(e)) => return Err(format!("Failed to get test output: {}", e)),
    Err(_) => {
      return Err(format!(
        "Full test suite timed out after {} seconds (likely infinite loop)",
        timeout.as_secs()
      ));
    }
  };

  if output.status.success() {
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
  } else {
    Err(format!(
      "{}\n{}",
      String::from_utf8_lossy(&output.stdout),
      String::from_utf8_lossy(&output.stderr)
    ))
  }
}

fn get_target_test_file(mutated_file: &str, language: &Language) -> Option<String> {
  match language {
    Language::TypeScript => {
      // TypeScript: "src/cli/git.ts" -> "src/cli/git.spec.ts"
      if mutated_file.ends_with(".ts") && !mutated_file.ends_with(".spec.ts") {
        let base = &mutated_file[..mutated_file.len() - 3]; // Remove ".ts"
        let test_file = format!("{}.spec.ts", base);

        // Check if the test file exists
        if std::path::Path::new(&test_file).exists() {
          Some(test_file)
        } else {
          None
        }
      } else {
        None
      }
    }
    Language::Rust => {
      // Rust test patterns:
      // 1. Tests in the same file (mod tests)
      // 2. Tests in separate test files in tests/ directory
      // 3. For now, we'll check if the file itself contains #[cfg(test)]

      if mutated_file.ends_with(".rs") {
        // For Rust, the tests are often in the same file
        // We'll return the same file if it contains tests
        if let Ok(content) = std::fs::read_to_string(mutated_file) {
          if content.contains("#[cfg(test)]") || content.contains("#[test]") {
            Some(mutated_file.to_string())
          } else {
            // Check for integration tests in tests/ directory
            let file_stem = std::path::Path::new(mutated_file)
              .file_stem()
              .and_then(|s| s.to_str())?;

            let test_file = format!("tests/{}.rs", file_stem);
            if std::path::Path::new(&test_file).exists() {
              Some(test_file)
            } else {
              None
            }
          }
        } else {
          None
        }
      } else {
        None
      }
    }
  }
}

fn send_response(response: WorkerResponse) -> Result<()> {
  // Write response to stdout
  let json = serde_json::to_string(&response).context("Failed to serialize response")?;

  println!("{}", json);
  io::stdout().flush().context("Failed to flush stdout")?;

  Ok(())
}
