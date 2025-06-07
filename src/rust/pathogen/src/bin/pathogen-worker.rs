use anyhow::{Context, Result};
use pathogen::{Language, MutationRequest, TestResult, WorkerMessage, WorkerResponse};
use std::io::{self, BufRead, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::time::Instant;

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

  let original_content = match __read_original_file(&target_file, &request, &start_time).await {
    Ok(content) => content,
    Err(result) => return result,
  };

  if let Err(result) = __apply_mutation(&target_file, &request, &start_time).await {
    return result;
  }

  let test_output = run_targeted_tests(&workspace_dir, &request.file_path, &request.language).await;
  __restore_original_file(&target_file, &original_content).await;

  let execution_time_ms = start_time.elapsed().as_millis() as u64;
  __create_test_result(test_output, execution_time_ms, request.mutation_id)
}

async fn __read_original_file(
  target_file: &PathBuf,
  request: &MutationRequest,
  start_time: &Instant,
) -> Result<String, TestResult> {
  match tokio::fs::read_to_string(target_file).await {
    Ok(content) => Ok(content),
    Err(e) => Err(TestResult {
      success: false,
      output: format!("FILE_ERROR: Failed to read original file: {}", e),
      execution_time_ms: start_time.elapsed().as_millis() as u64,
      mutation_id: request.mutation_id.clone(),
    }),
  }
}

async fn __apply_mutation(
  target_file: &PathBuf,
  request: &MutationRequest,
  start_time: &Instant,
) -> Result<(), TestResult> {
  match tokio::fs::write(target_file, &request.mutated_content).await {
    Ok(()) => Ok(()),
    Err(e) => Err(TestResult {
      success: false,
      output: format!("FILE_ERROR: Failed to write mutation: {}", e),
      execution_time_ms: start_time.elapsed().as_millis() as u64,
      mutation_id: request.mutation_id.clone(),
    }),
  }
}

async fn __restore_original_file(target_file: &PathBuf, original_content: &str) {
  if let Err(e) = tokio::fs::write(target_file, original_content).await {
    eprintln!(
      "WARNING: Failed to restore original content for {}: {}",
      target_file.display(),
      e
    );
  }
}

fn __create_test_result(
  test_output: Result<String, String>,
  execution_time_ms: u64,
  mutation_id: String,
) -> TestResult {
  match test_output {
    Ok(output) => __handle_successful_test(output, execution_time_ms, mutation_id),
    Err(error) => __handle_test_error(error, execution_time_ms, mutation_id),
  }
}

fn __handle_successful_test(
  output: String,
  execution_time_ms: u64,
  mutation_id: String,
) -> TestResult {
  let has_test_matches = !output.contains("had no matches");
  let tests_passed = output.contains("0 fail");

  let (success, formatted_output) = if !has_test_matches {
    (true, format!("NO_TESTS: {}", output))
  } else if tests_passed {
    (true, output)
  } else {
    (false, output)
  };

  TestResult {
    success,
    output: formatted_output,
    execution_time_ms,
    mutation_id,
  }
}

fn __handle_test_error(error: String, execution_time_ms: u64, mutation_id: String) -> TestResult {
  let (success, formatted_output) = if error.contains("timed out") {
    (false, format!("TIMEOUT: {}", error))
  } else if error.contains("Failed to spawn") || error.contains("Failed to get test output") {
    (false, format!("EXECUTION_ERROR: {}", error))
  } else {
    (false, error)
  };

  TestResult {
    success,
    output: formatted_output,
    execution_time_ms,
    mutation_id,
  }
}

async fn run_targeted_tests(
  workspace_dir: &PathBuf,
  mutated_file: &str,
  language: &Language,
) -> Result<String, String> {
  let test_file = match get_target_test_file(mutated_file, language) {
    Some(file) => file,
    None => return Ok("had no matches - no test file found".to_string()),
  };

  let child = __build_test_command(language, &test_file, workspace_dir)?;
  __execute_test_with_timeout(child, 5).await
}

fn __build_test_command(
  language: &Language,
  test_file: &str,
  workspace_dir: &PathBuf,
) -> Result<Child, String> {
  let mut child = Command::new(language.get_test_runner_command());

  for arg in language.get_test_args() {
    child.arg(arg);
  }

  __add_language_specific_args(&mut child, language, test_file);

  child
    .current_dir(workspace_dir)
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .spawn()
    .map_err(|e| format!("Failed to spawn targeted test command: {}", e))
}

fn __add_language_specific_args(child: &mut Command, language: &Language, test_file: &str) {
  match language {
    Language::TypeScript => {
      child.arg(test_file);
    }
    Language::Rust => {
      // For Rust, we'll run specific test functions/modules if possible
      // For now, just run all tests in the workspace
      // TODO: Add more targeted Rust test selection
    }
  }
}

async fn __execute_test_with_timeout(child: Child, timeout_secs: u64) -> Result<String, String> {
  let timeout = std::time::Duration::from_secs(timeout_secs);
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

fn get_target_test_file(mutated_file: &str, language: &Language) -> Option<String> {
  match language {
    Language::TypeScript => __get_typescript_test_file(mutated_file),
    Language::Rust => __get_rust_test_file(mutated_file),
  }
}

fn __get_typescript_test_file(mutated_file: &str) -> Option<String> {
  if !__is_valid_typescript_source(mutated_file) {
    return None;
  }

  let base = &mutated_file[..mutated_file.len() - 3]; // Remove ".ts"
  let test_file = format!("{}.spec.ts", base);

  if std::path::Path::new(&test_file).exists() {
    Some(test_file)
  } else {
    None
  }
}

fn __is_valid_typescript_source(file: &str) -> bool {
  file.ends_with(".ts") && !file.ends_with(".spec.ts")
}

fn __get_rust_test_file(mutated_file: &str) -> Option<String> {
  if !mutated_file.ends_with(".rs") {
    return None;
  }

  __check_same_file_tests(mutated_file).or_else(|| __check_integration_tests(mutated_file))
}

fn __check_same_file_tests(mutated_file: &str) -> Option<String> {
  let content = std::fs::read_to_string(mutated_file).ok()?;
  if content.contains("#[cfg(test)]") || content.contains("#[test]") {
    Some(mutated_file.to_string())
  } else {
    None
  }
}

fn __check_integration_tests(mutated_file: &str) -> Option<String> {
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

fn send_response(response: WorkerResponse) -> Result<()> {
  // Write response to stdout
  let json = serde_json::to_string(&response).context("Failed to serialize response")?;

  println!("{}", json);
  io::stdout().flush().context("Failed to flush stdout")?;

  Ok(())
}
