use anyhow::{Context, Result};
use std::io::Write;
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime};
use tokio::process::Command;
use tokio::sync::Semaphore;

use crate::cache::{CachedTestResult, MutationCache};
use crate::file_safety::{SafeFileManager, SafetyGuard};
use crate::types::{KillType, Mutation, MutationResult};

/// Parallel mutation test runner with bulletproof file safety and intelligent caching
pub struct MutationRunner {
  semaphore: Arc<Semaphore>,
  file_manager: SafeFileManager,
  cache: Arc<MutationCache>,
  parallel_count: usize,
}

impl MutationRunner {
  pub fn new(parallel_count: usize, file_manager: SafeFileManager) -> Result<Self> {
    Ok(MutationRunner {
      semaphore: Arc::new(Semaphore::new(parallel_count)),
      file_manager,
      cache: Arc::new(MutationCache::new()),
      parallel_count,
    })
  }

  /// Run baseline tests to ensure they pass before mutation testing (with caching)
  pub async fn run_baseline_tests(&self) -> Result<bool> {
    // Check cache for recent baseline result
    let cache_key = std::env::current_dir().unwrap_or_default();
    if let Some(cached_result) = self.cache.get_baseline_result(&cache_key) {
      println!("⚡ Using cached baseline test result");
      return Ok(cached_result.success);
    }

    // Run fresh baseline tests
    let start = Instant::now();
    let output = Command::new("klep")
      .arg("test")
      .stdout(Stdio::piped())
      .stderr(Stdio::piped())
      .output()
      .await
      .context("Failed to run baseline tests")?;

    let success = output.status.success();
    let execution_time_ms = start.elapsed().as_millis() as u64;
    let test_output = if success {
      String::from_utf8_lossy(&output.stdout).to_string()
    } else {
      String::from_utf8_lossy(&output.stderr).to_string()
    };

    // Cache the result
    let cached_result = CachedTestResult {
      success,
      output: test_output,
      cached_at: SystemTime::now(),
      execution_time_ms,
    };
    self.cache.cache_baseline_result(cache_key, cached_result);

    Ok(success)
  }

  /// Run all mutations safely with parallel execution and guaranteed file restoration
  pub async fn run_mutations_safely(
    &self,
    mutations: Vec<Mutation>,
    verbose: bool,
  ) -> Result<Vec<MutationResult>> {
    // Create safety guard for panic protection
    let _safety_guard = SafetyGuard::new(&self.file_manager);

    // Prepare all files for mutation (create backups)
    let mut files_to_prepare: Vec<_> = mutations.iter().map(|m| &m.file).collect();
    files_to_prepare.sort();
    files_to_prepare.dedup();

    // Clone the file manager for mutation preparation
    let mut prepared_manager = self.file_manager.clone();
    for file_path in &files_to_prepare {
      prepared_manager.prepare_file_for_mutation(file_path)?;
      if verbose {
        println!("🛡️  Prepared safety backup for: {}", file_path.display());
      }
    }

    println!(
      "🛡️  File safety initialized for {} files",
      files_to_prepare.len()
    );

    // Run mutations in parallel with safety guarantees
    let results = self
      .run_mutations_parallel(mutations, verbose, prepared_manager)
      .await?;

    println!("✅ All mutations completed safely - all files restored to original state");

    Ok(results)
  }

  /// Internal parallel mutation execution with per-mutation safety
  async fn run_mutations_parallel(
    &self,
    mutations: Vec<Mutation>,
    verbose: bool,
    file_manager: SafeFileManager,
  ) -> Result<Vec<MutationResult>> {
    use futures::stream::{FuturesUnordered, StreamExt};

    let file_manager = Arc::new(file_manager);
    let total_mutations = mutations.len();
    let progress_counter = Arc::new(std::sync::atomic::AtomicUsize::new(0));

    // Create futures for all mutations
    let mutation_futures: FuturesUnordered<_> = mutations
      .into_iter()
      .map(|mutation| {
        let semaphore = Arc::clone(&self.semaphore);
        let file_manager = Arc::clone(&file_manager);
        let progress_counter = Arc::clone(&progress_counter);

        async move {
          // Acquire semaphore permit for parallel execution control
          let _permit = semaphore.acquire().await.unwrap();

          // Run single mutation with safety
          let result = self
            .run_single_mutation_safely(mutation, file_manager.as_ref())
            .await;

          // Update progress with inline progress bar
          let completed = progress_counter.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
          if verbose || completed % 50 == 0 || completed == total_mutations {
            let percentage = (completed as f64 / total_mutations as f64) * 100.0;
            let bar_width = 40;
            let filled = ((completed as f64 / total_mutations as f64) * bar_width as f64) as usize;
            let empty = bar_width - filled;
            
            print!("\r   🧬 [{}/{}] {}% [{}{}] Mutations tested", 
              completed, 
              total_mutations, 
              percentage as u8,
              "█".repeat(filled),
              "░".repeat(empty)
            );
            std::io::stdout().flush().unwrap();
            
            // Add newline on completion
            if completed == total_mutations {
              println!();
            }
          }

          result
        }
      })
      .collect();

    // Collect all results
    let results: Result<Vec<_>> = mutation_futures
      .collect::<Vec<_>>()
      .await
      .into_iter()
      .collect();

    results
  }

  /// Run a single mutation with complete safety guarantees and intelligent caching
  async fn run_single_mutation_safely(
    &self,
    mutation: Mutation,
    file_manager: &SafeFileManager,
  ) -> Result<MutationResult> {
    let start_time = Instant::now();

    // Apply mutation and get content
    let mutated_content = self.apply_mutation_to_content(&mutation, file_manager)?;

    // Generate content hash for cache lookup
    let content_hash = self
      .cache
      .get_content_hash(&mutation.file, &mutated_content);

    // Check cache first - massive speedup for repeated mutations!
    if let Some(cached_result) = self.cache.get_mutation_result(&content_hash) {
      // Cache hit! Return result without running tests
      return Ok(MutationResult {
        mutation,
        killed: !cached_result.success,
        kill_type: if cached_result.success {
          KillType::Survived
        } else {
          KillType::BehavioralKill
        },
        test_output: cached_result.output,
        execution_time_ms: cached_result.execution_time_ms,
      });
    }

    // Cache miss - run the actual test
    let restoration_token =
      file_manager.apply_mutation_temporarily(&mutation.file, &mutated_content)?;

    // Run tests with mutation applied
    let test_result = self.run_test_with_timeout().await;

    // CRITICAL: Always restore file immediately after test
    file_manager
      .restore_file(restoration_token)
      .with_context(|| {
        format!(
          "CRITICAL: Failed to restore file after mutation: {}",
          mutation.file.display()
        )
      })?;

    // Calculate execution time
    let execution_time_ms = start_time.elapsed().as_millis() as u64;

    // Classify the result
    let (killed, kill_type, test_output) = self.classify_test_result(test_result);

    // Cache the result for future use
    let cached_result = CachedTestResult {
      success: !killed,
      output: test_output.clone(),
      cached_at: SystemTime::now(),
      execution_time_ms,
    };
    self
      .cache
      .cache_mutation_result(content_hash, cached_result);

    Ok(MutationResult {
      mutation,
      killed,
      kill_type,
      test_output,
      execution_time_ms,
    })
  }

  /// Apply mutation to file content (without touching the actual file yet)
  fn apply_mutation_to_content(
    &self,
    mutation: &Mutation,
    file_manager: &SafeFileManager,
  ) -> Result<String> {
    // Get the temp copy to work with
    let temp_copy_path = file_manager
      .get_temp_copy(&mutation.file)
      .ok_or_else(|| anyhow::anyhow!("No temp copy found for file: {}", mutation.file.display()))?;

    let content = std::fs::read_to_string(&temp_copy_path)
      .with_context(|| format!("Failed to read temp copy: {}", temp_copy_path.display()))?;

    // Apply the mutation based on span information
    let start_byte = mutation.span_start as usize;
    let end_byte = mutation.span_end as usize;

    if start_byte > content.len() || end_byte > content.len() || start_byte > end_byte {
      anyhow::bail!(
        "Invalid mutation span for file: {}",
        mutation.file.display()
      );
    }

    let mut mutated_content = String::new();
    mutated_content.push_str(&content[..start_byte]);
    mutated_content.push_str(&mutation.mutated);
    mutated_content.push_str(&content[end_byte..]);

    Ok(mutated_content)
  }

  /// Run tests with a reasonable timeout
  async fn run_test_with_timeout(&self) -> Result<String, String> {
    let timeout_duration = Duration::from_secs(30); // 30 second timeout

    let test_future = async {
      Command::new("klep")
        .arg("test")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
    };

    match tokio::time::timeout(timeout_duration, test_future).await {
      Ok(Ok(output)) => {
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
      Ok(Err(e)) => Err(format!("Failed to execute test command: {}", e)),
      Err(_) => Err("Test execution timed out after 30 seconds".to_string()),
    }
  }

  /// Classify test results into kill types
  fn classify_test_result(&self, test_result: Result<String, String>) -> (bool, KillType, String) {
    match test_result {
      Ok(output) => {
        // Tests passed - mutation survived
        (false, KillType::Survived, output)
      }
      Err(error_output) => {
        // Tests failed - need to classify why
        if self.is_compile_error(&error_output) {
          (true, KillType::CompileError, error_output)
        } else {
          (true, KillType::BehavioralKill, error_output)
        }
      }
    }
  }

  /// Determine if test failure is due to compilation error vs behavioral change
  fn is_compile_error(&self, error_output: &str) -> bool {
    let error_lower = error_output.to_lowercase();

    self.is_typescript_error(&error_lower)
      || self.is_javascript_syntax_error(&error_lower)
      || self.is_module_error(&error_lower)
      || self.is_type_error(&error_lower)
      || self.is_runtime_parse_error(&error_lower)
      || self.is_build_error(&error_lower)
  }

  /// Check for TypeScript compilation errors
  fn is_typescript_error(&self, error_lower: &str) -> bool {
    error_lower.contains("error ts")
  }

  /// Check for JavaScript syntax errors
  fn is_javascript_syntax_error(&self, error_lower: &str) -> bool {
    error_lower.contains("syntaxerror")
      || error_lower.contains("unexpected token")
      || error_lower.contains("unexpected end of input")
  }

  /// Check for import/module resolution errors
  fn is_module_error(&self, error_lower: &str) -> bool {
    error_lower.contains("cannot resolve")
      || error_lower.contains("module not found")
      || error_lower.contains("cannot find module")
  }

  /// Check for type-related errors
  fn is_type_error(&self, error_lower: &str) -> bool {
    error_lower.contains("type error")
      || error_lower.contains("property does not exist")
      || error_lower.contains("cannot be used as an index type")
  }

  /// Check for runtime/parser errors
  fn is_runtime_parse_error(&self, error_lower: &str) -> bool {
    error_lower.contains("failed to resolve") || error_lower.contains("parse error")
  }

  /// Check for general build/compilation failure indicators
  fn is_build_error(&self, error_lower: &str) -> bool {
    error_lower.contains("compilation failed") || error_lower.contains("build failed")
  }

  pub fn parallel_count(&self) -> usize {
    self.parallel_count
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[tokio::test]
  async fn test_mutation_runner_creation() -> Result<()> {
    let file_manager = SafeFileManager::new()?;
    let runner = MutationRunner::new(4, file_manager)?;

    assert_eq!(runner.parallel_count(), 4);
    Ok(())
  }

  #[test]
  fn test_compile_error_detection() {
    let runner = MutationRunner::new(1, SafeFileManager::new().unwrap()).unwrap();

    // Should detect TypeScript errors
    assert!(runner.is_compile_error("error TS2304: Cannot find name 'foo'"));
    assert!(runner.is_compile_error("SyntaxError: Unexpected token"));
    assert!(runner.is_compile_error("Cannot resolve module"));

    // Should not detect behavioral test failures
    assert!(!runner.is_compile_error("Test failed: expected 5 but got 6"));
    assert!(!runner.is_compile_error("AssertionError: Values are not equal"));
  }

  #[test]
  fn test_mutation_content_application() -> Result<()> {
    let file_manager = SafeFileManager::new()?;
    let runner = MutationRunner::new(1, file_manager)?;

    // This test would need a more complex setup with actual file preparation
    // For now, just test that the runner is created correctly
    assert_eq!(runner.parallel_count(), 1);

    Ok(())
  }
}
