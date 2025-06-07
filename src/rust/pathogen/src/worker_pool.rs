use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, Mutex, Semaphore};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MutationRequest {
    pub file_path: String,
    pub mutated_content: String,
    pub mutation_id: String,
    pub workspace_dir: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TestResult {
    pub success: bool,
    pub output: String,
    pub execution_time_ms: u64,
    pub mutation_id: String,
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

pub struct WorkerProcess {
    child: Child,
    sender: mpsc::UnboundedSender<String>,
    receiver: mpsc::UnboundedReceiver<String>,
    id: usize,
    created_at: Instant,
    executions: usize,
}

impl WorkerProcess {
    pub async fn new(id: usize, workspace_dir: &PathBuf) -> Result<Self> {
        // Spawn pathogen-worker directly using IPC communication
        let worker_binary = std::env::current_exe()?
            .parent()
            .context("Failed to get binary directory")?
            .join("pathogen-worker");
            
        let mut child = Command::new(worker_binary)
            .current_dir(workspace_dir)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::inherit())
            .kill_on_drop(true)
            .spawn()
            .context("Failed to spawn pathogen worker")?;

        let (tx, rx) = mpsc::unbounded_channel();
        let (response_tx, response_rx) = mpsc::unbounded_channel();

        // Set up IPC communication
        let stdin = child.stdin.take().context("Failed to get worker stdin")?;
        let stdout = child.stdout.take().context("Failed to get worker stdout")?;

        // Spawn tasks to handle IPC
        Self::spawn_writer_task(stdin, rx);
        Self::spawn_reader_task(stdout, response_tx);

        // Wait for ready signal
        let mut response_receiver = response_rx;
        if let Some(response_line) = response_receiver.recv().await {
            match serde_json::from_str::<WorkerResponse>(&response_line) {
                Ok(WorkerResponse::Ready) => {
                    // Worker is ready
                }
                Ok(other) => {
                    anyhow::bail!("Unexpected response from worker: {:?}", other);
                }
                Err(e) => {
                    anyhow::bail!("Failed to parse worker response: {}", e);
                }
            }
        } else {
            anyhow::bail!("Worker process failed to start");
        }

        Ok(WorkerProcess {
            child,
            sender: tx,
            receiver: response_receiver,
            id,
            created_at: Instant::now(),
            executions: 0,
        })
    }

    fn spawn_writer_task(
        mut stdin: tokio::process::ChildStdin,
        mut receiver: mpsc::UnboundedReceiver<String>,
    ) {
        tokio::spawn(async move {
            use tokio::io::AsyncWriteExt;
            while let Some(message) = receiver.recv().await {
                if let Err(_) = stdin.write_all(format!("{}\n", message).as_bytes()).await {
                    break;
                }
                let _ = stdin.flush().await;
            }
        });
    }

    fn spawn_reader_task(
        stdout: tokio::process::ChildStdout,
        sender: mpsc::UnboundedSender<String>,
    ) {
        tokio::spawn(async move {
            use tokio::io::{AsyncBufReadExt, BufReader};
            let mut reader = BufReader::new(stdout);
            let mut line = String::new();
            
            loop {
                line.clear();
                match reader.read_line(&mut line).await {
                    Ok(0) => break, // EOF
                    Ok(_) => {
                        let trimmed = line.trim();
                        if !trimmed.is_empty() {
                            if sender.send(trimmed.to_string()).is_err() {
                                break;
                            }
                        }
                    }
                    Err(_) => break,
                }
            }
        });
    }

    pub async fn execute_mutation(&mut self, request: MutationRequest) -> Result<TestResult> {
        // Send mutation request
        let message = WorkerMessage::MutationRequest(request.clone());
        let json = serde_json::to_string(&message)?;
        
        self.sender.send(json)
            .map_err(|_| anyhow::anyhow!("Failed to send message to worker"))?;

        // Apply timeout at worker level (10 seconds total, including test execution)
        let timeout = std::time::Duration::from_secs(10);
        match tokio::time::timeout(timeout, async {
            if let Some(response_line) = self.receiver.recv().await {
                match serde_json::from_str::<WorkerResponse>(&response_line)? {
                    WorkerResponse::TestResult(result) => {
                        self.executions += 1;
                        Ok(result)
                    },
                    WorkerResponse::Error(error) => {
                        anyhow::bail!("Worker error: {}", error);
                    }
                    other => {
                        anyhow::bail!("Unexpected response from worker: {:?}", other);
                    }
                }
            } else {
                anyhow::bail!("Worker process died")
            }
        }).await {
            Ok(result) => result,
            Err(_) => {
                // Timeout occurred - kill this worker and return a timeout result
                let _ = self.child.kill().await;
                Ok(TestResult {
                    success: false,
                    output: format!("Worker timeout after {} seconds (likely infinite loop mutation)", timeout.as_secs()),
                    execution_time_ms: timeout.as_millis() as u64,
                    mutation_id: request.mutation_id,
                })
            }
        }
    }

    pub fn is_healthy(&mut self) -> bool {
        let age = self.created_at.elapsed();
        match self.child.try_wait() {
            Ok(Some(_)) => false, // Process has exited
            Ok(None) => {
                // Much more aggressive recycling for high-throughput mutation testing
                age < std::time::Duration::from_secs(30) && // Max 30 seconds old
                self.executions < 50 // Max 50 executions per worker
            }
            Err(_) => false, // Error checking status
        }
    }

    pub async fn shutdown(mut self) -> Result<()> {
        // Send shutdown message
        let message = WorkerMessage::Shutdown;
        let json = serde_json::to_string(&message)?;
        let _ = self.sender.send(json);

        // Give it a moment to shut down gracefully
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;

        // Force kill if still running
        let _ = self.child.kill().await;
        Ok(())
    }
}

pub struct WorkerPool {
    available_workers: Arc<Mutex<VecDeque<WorkerProcess>>>,
    busy_workers: Arc<Mutex<Vec<WorkerProcess>>>,
    semaphore: Arc<Semaphore>,
    workspace_dir: PathBuf,
    pool_size: usize,
    next_id: Arc<Mutex<usize>>,
}

impl WorkerPool {
    pub async fn new(pool_size: usize, workspace_dir: PathBuf) -> Result<Self> {
        let mut available_workers = VecDeque::new();

        // Pre-create the worker pool
        for i in 0..pool_size {
            let worker = WorkerProcess::new(i, &workspace_dir).await?;
            available_workers.push_back(worker);
        }

        Ok(WorkerPool {
            available_workers: Arc::new(Mutex::new(available_workers)),
            busy_workers: Arc::new(Mutex::new(Vec::new())),
            semaphore: Arc::new(Semaphore::new(pool_size)),
            workspace_dir,
            pool_size,
            next_id: Arc::new(Mutex::new(pool_size)),
        })
    }

    pub async fn execute_mutation(&self, request: MutationRequest) -> Result<TestResult> {
        // Acquire semaphore permit
        let _permit = self.semaphore.acquire().await.unwrap();

        // Get an available worker
        let mut worker = self.get_worker().await?;

        // Execute the mutation
        let result = worker.execute_mutation(request).await;

        // Return worker to pool
        self.return_worker(worker).await;

        result
    }

    pub async fn run_mutations(&self, mutations: Vec<crate::types::Mutation>, _verbose: bool) -> Result<Vec<crate::types::MutationResult>> {
        use futures::stream::{FuturesUnordered, StreamExt};
        use indicatif::{ProgressBar, ProgressStyle};
        use std::sync::atomic::{AtomicUsize, Ordering};
        
        let total = mutations.len();
        println!("📊 Processing {} mutations across {} workers...", total, self.pool_size);
        
        // Create progress bar
        let progress = ProgressBar::new(total as u64);
        progress.set_style(
            ProgressStyle::default_bar()
                .template("  {spinner:.green} [{bar:40.cyan/blue}] {pos}/{len} mutations ({percent}%) | ETA: {eta}")?
                .progress_chars("█▉▊▋▌▍▎▏ ")
        );
        
        let completed = Arc::new(AtomicUsize::new(0));
        
        let futures: FuturesUnordered<_> = mutations.into_iter().map(|mutation| {
            let pool = self; // Already a reference
            let progress = progress.clone();
            let completed = completed.clone();
            async move {
                let request = MutationRequest {
                    file_path: mutation.file.to_string_lossy().to_string(),
                    mutated_content: mutation.mutated.clone(),
                    mutation_id: mutation.id.clone(),
                    workspace_dir: self.workspace_dir.to_string_lossy().to_string(),
                };
                
                let test_result = pool.execute_mutation(request).await?;
                
                // Update progress
                let current = completed.fetch_add(1, Ordering::Relaxed) + 1;
                progress.set_position(current as u64);
                
                // Convert to MutationResult
                let kill_type = if test_result.success {
                    crate::types::KillType::Survived
                } else {
                    if test_result.output.contains("compilation") || test_result.output.contains("syntax") {
                        crate::types::KillType::CompileError
                    } else {
                        crate::types::KillType::BehavioralKill
                    }
                };
                
                Ok::<crate::types::MutationResult, anyhow::Error>(crate::types::MutationResult {
                    mutation,
                    killed: kill_type != crate::types::KillType::Survived,
                    kill_type,
                    test_output: test_result.output,
                    execution_time_ms: test_result.execution_time_ms,
                })
            }
        }).collect();
        
        let results: Vec<_> = futures.collect().await;
        progress.finish_with_message("✓ All mutations completed!");
        
        let mut mutation_results = Vec::new();
        
        for result in results {
            mutation_results.push(result?);
        }
        
        Ok(mutation_results)
    }

    async fn get_worker(&self) -> Result<WorkerProcess> {
        let mut available = self.available_workers.lock().await;
        
        // Try to get a healthy worker from the pool
        while let Some(mut worker) = available.pop_front() {
            if worker.is_healthy() {
                return Ok(worker);
            } else {
                // Worker is unhealthy, shut it down and create a new one
                let _ = worker.shutdown().await;
            }
        }

        // No healthy workers available, create a new one
        let next_id = {
            let mut id_guard = self.next_id.lock().await;
            let id = *id_guard;
            *id_guard += 1;
            id
        };

        WorkerProcess::new(next_id, &self.workspace_dir).await
    }

    async fn return_worker(&self, mut worker: WorkerProcess) {
        if worker.is_healthy() {
            self.available_workers.lock().await.push_back(worker);
        } else {
            let _ = worker.shutdown().await;
        }
    }

    pub async fn shutdown(self) -> Result<()> {
        // Shutdown all available workers
        let mut available = self.available_workers.lock().await;
        while let Some(worker) = available.pop_front() {
            let _ = worker.shutdown().await;
        }

        // Shutdown all busy workers
        let mut busy = self.busy_workers.lock().await;
        while let Some(worker) = busy.pop() {
            let _ = worker.shutdown().await;
        }

        Ok(())
    }
} 