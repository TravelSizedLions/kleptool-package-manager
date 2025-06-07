use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::io::{self, BufRead, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::Instant;

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

    // Run tests
    let test_output = run_tests(&workspace_dir).await;
    let execution_time_ms = start_time.elapsed().as_millis() as u64;

    match test_output {
        Ok(output) => TestResult {
            success: output.contains("0 fail"),
            output,
            execution_time_ms,
            mutation_id: request.mutation_id,
        },
        Err(error) => TestResult {
            success: false,
            output: error,
            execution_time_ms,
            mutation_id: request.mutation_id,
        },
    }
}

async fn run_tests(workspace_dir: &PathBuf) -> Result<String, String> {
    let output = Command::new("klep")
        .arg("test")
        .current_dir(workspace_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("Failed to spawn test command: {}", e))?;

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

fn send_response(response: WorkerResponse) -> Result<()> {
    // Write response to stdout
    let json = serde_json::to_string(&response)
        .context("Failed to serialize response")?;
    
    println!("{}", json);
    io::stdout().flush()
        .context("Failed to flush stdout")?;
    
    Ok(())
}

 