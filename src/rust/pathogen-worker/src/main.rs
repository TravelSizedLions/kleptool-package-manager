use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::io::{self, BufRead, Write};
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Instant;
use tokio::process::Command;

#[derive(Debug, Serialize, Deserialize)]
struct MutationRequest {
    file_path: String,
    mutated_content: String,
    mutation_id: String,
    workspace_dir: String,
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
                output: format!("Failed to read original file: {}", e),
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
            output: format!("Failed to write mutation: {}", e),
            execution_time_ms: start_time.elapsed().as_millis() as u64,
            mutation_id: request.mutation_id,
        };
    }

    // Run targeted tests for massive performance improvement
    let test_output = run_targeted_tests(&workspace_dir, &request.file_path).await;
    
    // CRITICAL: Restore original content after test
    let restore_result = tokio::fs::write(&target_file, &original_content).await;
    if let Err(e) = restore_result {
        eprintln!("WARNING: Failed to restore original content for {}: {}", target_file.display(), e);
    }

    let execution_time_ms = start_time.elapsed().as_millis() as u64;

    match test_output {
        Ok(output) => {
            // Check for test success:
            // - "0 fail" = tests passed, mutation survived
            // - "had no matches" = no tests found, classify as error to prevent false positives
            // - anything else = tests failed, mutation killed
            let has_test_matches = !output.contains("had no matches");
            let tests_passed = output.contains("0 fail");
            let success = has_test_matches && tests_passed;
            
            TestResult {
                success,
                output,
                execution_time_ms,
                mutation_id: request.mutation_id,
            }
        },
        Err(error) => {
            // CRITICAL FIX: Timeouts should not be classified as behavioral kills!
            // They should be treated as inconclusive/errors
            let is_timeout = error.contains("timed out");
            
            TestResult {
                // Timeouts are NOT behavioral kills - they're inconclusive
                // Only non-timeout errors should be considered behavioral kills
                success: false,
                output: if is_timeout {
                    format!("TIMEOUT: {}", error) // Mark timeouts clearly in output
                } else {
                    error
                },
                execution_time_ms,
                mutation_id: request.mutation_id,
            }
        },
    }
}

async fn run_targeted_tests(workspace_dir: &PathBuf, mutated_file: &str) -> Result<String, String> {
    // Implement targeted test selection for massive performance gains
    // Instead of running all 154 tests, only run tests relevant to the mutated file
    
    let start = std::time::Instant::now();
    
    // Determine the target test file based on the mutated file
    let test_file = if let Some(spec_file) = get_target_test_file(mutated_file) {
        spec_file
    } else {
        // Fall back to full suite if we can't determine target test
        return run_full_test_suite(workspace_dir).await;
    };
    
    // Run the specific test file with timeout to prevent infinite loops
    let mut child = Command::new("bun")
        .arg("test")
        .arg(&test_file)
        .current_dir(workspace_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .process_group(0) // Create new process group for easier cleanup
        .spawn()
        .map_err(|e| format!("Failed to spawn targeted test command: {}", e))?;
    
    // Set a reasonable timeout (5 seconds for targeted tests)
    let timeout = std::time::Duration::from_secs(5);
    let child_id = child.id();
    
    let output = match tokio::time::timeout(timeout, async move {
        child.wait_with_output().await
    }).await {
        Ok(Ok(output)) => output,
        Ok(Err(e)) => return Err(format!("Failed to get test output: {}", e)),
        Err(_) => {
            // Timeout occurred - aggressively kill the entire process group
            if let Some(pid) = child_id {
                // Kill the entire process group (negative PID kills process group)
                let _ = tokio::process::Command::new("kill")
                    .arg("-TERM")
                    .arg(format!("-{}", pid)) // Negative PID = kill process group
                    .output()
                    .await;
                    
                // Wait a moment for graceful termination
                tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
                    
                // Force kill the entire process group if still running
                let _ = tokio::process::Command::new("kill")
                    .arg("-KILL")
                    .arg(format!("-{}", pid)) // Negative PID = kill process group
                    .output()
                    .await;
            }
            return Err(format!("Test timed out after {} seconds (likely infinite loop)", timeout.as_secs()));
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
    let mut child = Command::new("klep")
        .arg("ts:test")
        .current_dir(workspace_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .process_group(0) // Create new process group for easier cleanup
        .spawn()
        .map_err(|e| format!("Failed to spawn full test command: {}", e))?;
    
    // Longer timeout for full test suite (30 seconds)
    let timeout = std::time::Duration::from_secs(30);
    let child_id = child.id();
    
    let output = match tokio::time::timeout(timeout, async move {
        child.wait_with_output().await
    }).await {
        Ok(Ok(output)) => output,
        Ok(Err(e)) => return Err(format!("Failed to get test output: {}", e)),
        Err(_) => {
            // Timeout occurred - aggressively kill the entire process group
            if let Some(pid) = child_id {
                // Kill the entire process group (negative PID kills process group)
                let _ = tokio::process::Command::new("kill")
                    .arg("-TERM")
                    .arg(format!("-{}", pid)) // Negative PID = kill process group
                    .output()
                    .await;
                    
                // Wait a moment for graceful termination
                tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
                    
                // Force kill the entire process group if still running
                let _ = tokio::process::Command::new("kill")
                    .arg("-KILL")
                    .arg(format!("-{}", pid)) // Negative PID = kill process group
                    .output()
                    .await;
            }
            return Err(format!("Full test suite timed out after {} seconds (likely infinite loop)", timeout.as_secs()));
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

fn get_target_test_file(mutated_file: &str) -> Option<String> {
    // Map mutated files to their corresponding test files
    // Example: "src/cli/git.ts" -> "src/cli/git.spec.ts"
    
    if mutated_file.ends_with(".ts") && !mutated_file.ends_with(".spec.ts") {
        let base = mutated_file.strip_suffix(".ts")?;
        let test_file = format!("{}.spec.ts", base);
        
        // Only return if the test file actually exists
        if std::path::Path::new(&test_file).exists() {
            Some(test_file)
        } else {
            None // Fall back to full test suite if specific test doesn't exist
        }
    } else {
        None
    }
}

fn send_response(response: WorkerResponse) -> Result<()> {
    // Write response to stdout
    let json = serde_json::to_string(&response)
        .context("Failed to serialize response")?;
    
    println!("{}", json);
    io::stdout().flush()
        .context("Failed to flush stdout")?;
    
    Ok(())
}

 