use anyhow::{Context, Result};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tempfile::TempDir;
use uuid::Uuid;

/// Inner data for SafeFileManager that can be shared
struct SafeFileManagerInner {
  /// Temporary directory for all operations
  temp_dir: TempDir,
  /// Map of original file paths to temporary copies
  temp_copies: HashMap<PathBuf, PathBuf>,
  /// Original file contents for restoration
  original_contents: HashMap<PathBuf, String>,
}

/// Bulletproof file safety manager that ensures NO permanent changes to source files
/// Uses atomic operations, temporary copies, and comprehensive cleanup
#[derive(Clone)]
pub struct SafeFileManager {
  inner: Arc<std::sync::Mutex<SafeFileManagerInner>>,
}

impl SafeFileManager {
  pub fn new() -> Result<Self> {
    let temp_dir =
      TempDir::new().context("Failed to create temporary directory for safe file operations")?;

    println!(
      "🛡️  Initialized safe file manager with temp dir: {:?}",
      temp_dir.path()
    );

    let inner = SafeFileManagerInner {
      temp_dir,
      temp_copies: HashMap::new(),
      original_contents: HashMap::new(),
    };

    Ok(SafeFileManager {
      inner: Arc::new(std::sync::Mutex::new(inner)),
    })
  }

  /// Create a temporary working copy of a file and backup the original content
  pub fn prepare_file_for_mutation(&mut self, file_path: &Path) -> Result<PathBuf> {
    // Read and backup original content
    let original_content = fs::read_to_string(file_path)
      .with_context(|| format!("Failed to read original file: {}", file_path.display()))?;

    let mut inner = self.inner.lock().unwrap();

    // Create unique temporary file path
    let file_id = Uuid::new_v4();
    let temp_file_name = format!(
      "mutation_{}_{}",
      file_id.simple(),
      file_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown.ts")
    );
    let temp_file_path = inner.temp_dir.path().join(temp_file_name);

    // Write original content to temp file
    fs::write(&temp_file_path, &original_content)
      .with_context(|| format!("Failed to create temp copy: {}", temp_file_path.display()))?;

    // Store mappings for safety
    inner
      .temp_copies
      .insert(file_path.to_path_buf(), temp_file_path.clone());
    inner
      .original_contents
      .insert(file_path.to_path_buf(), original_content);

    Ok(temp_file_path)
  }

  /// Apply a mutation to the ORIGINAL file (temporarily)
  /// Returns a restoration token that MUST be used to restore the file
  pub fn apply_mutation_temporarily(
    &self,
    file_path: &Path,
    mutated_content: &str,
  ) -> Result<RestorationToken> {
    let inner = self.inner.lock().unwrap();

    // Verify we have the original content backed up
    let original_content = inner
      .original_contents
      .get(file_path)
      .with_context(|| format!("No backup found for file: {}", file_path.display()))?;

    // Apply mutation to the ACTUAL file (this is the risky part!)
    fs::write(file_path, mutated_content)
      .with_context(|| format!("Failed to apply mutation to: {}", file_path.display()))?;

    // Return restoration token
    Ok(RestorationToken {
      file_path: file_path.to_path_buf(),
      original_content: original_content.clone(),
    })
  }

  /// Restore a file from a restoration token
  pub fn restore_file(&self, token: RestorationToken) -> Result<()> {
    fs::write(&token.file_path, &token.original_content).with_context(|| {
      format!(
        "CRITICAL: Failed to restore file: {}",
        token.file_path.display()
      )
    })?;

    Ok(())
  }

  /// Get the temp copy path for a file (for AST parsing without touching original)
  pub fn get_temp_copy(&self, file_path: &Path) -> Option<PathBuf> {
    let inner = self.inner.lock().unwrap();
    inner.temp_copies.get(file_path).cloned()
  }

  /// Emergency restore ALL files to their original state
  pub fn emergency_restore_all(&self) -> Result<()> {
    println!("🚨 EMERGENCY RESTORATION - Restoring all files to original state");

    let inner = self.inner.lock().unwrap();
    let mut errors = Vec::new();

    for (file_path, original_content) in &inner.original_contents {
      if let Err(e) = fs::write(file_path, original_content) {
        errors.push(format!("Failed to restore {}: {}", file_path.display(), e));
      } else {
        println!("   ✅ Restored: {}", file_path.display());
      }
    }

    if !errors.is_empty() {
      anyhow::bail!(
        "CRITICAL ERRORS during emergency restoration:\n{}",
        errors.join("\n")
      );
    }

    Ok(())
  }

  /// Get statistics about managed files
  pub fn stats(&self) -> FileSafetyStats {
    let inner = self.inner.lock().unwrap();
    FileSafetyStats {
      files_managed: inner.original_contents.len(),
      temp_dir_path: inner.temp_dir.path().to_path_buf(),
    }
  }
}

/// Token that represents a file in a mutated state that MUST be restored
#[must_use = "RestorationToken must be used to restore the file or data will be lost"]
pub struct RestorationToken {
  file_path: PathBuf,
  original_content: String,
}

impl RestorationToken {
  pub fn file_path(&self) -> &Path {
    &self.file_path
  }
}

/// Safe Drop implementation that attempts restoration if token is dropped
impl Drop for RestorationToken {
  fn drop(&mut self) {
    // Attempt emergency restoration if token is dropped without manual restoration
    if let Err(e) = fs::write(&self.file_path, &self.original_content) {
      eprintln!(
        "🚨 EMERGENCY: Failed to auto-restore file during Drop: {} - {}",
        self.file_path.display(),
        e
      );
    } else {
      println!(
        "🛡️  Auto-restored file during cleanup: {}",
        self.file_path.display()
      );
    }
  }
}

#[derive(Debug)]
pub struct FileSafetyStats {
  pub files_managed: usize,
  pub temp_dir_path: PathBuf,
}

/// RAII guard that ensures emergency restoration on panic
pub struct SafetyGuard<'a> {
  file_manager: &'a SafeFileManager,
}

impl<'a> SafetyGuard<'a> {
  pub fn new(file_manager: &'a SafeFileManager) -> Self {
    SafetyGuard { file_manager }
  }
}

impl<'a> Drop for SafetyGuard<'a> {
  fn drop(&mut self) {
    if std::thread::panicking() {
      println!("🚨 PANIC DETECTED - Attempting emergency file restoration");
      if let Err(e) = self.file_manager.emergency_restore_all() {
        eprintln!(
          "💥 CRITICAL: Emergency restoration failed during panic: {}",
          e
        );
      }
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::io::Write;
  use tempfile::NamedTempFile;

  #[test]
  fn test_file_safety_basic_operations() -> Result<()> {
    let mut manager = SafeFileManager::new()?;

    // Create a test file
    let mut test_file = NamedTempFile::new()?;
    writeln!(test_file, "const original = 'content';")?;
    let test_path = test_file.path();

    // Prepare file for mutation
    let _temp_copy = manager.prepare_file_for_mutation(test_path)?;

    // Apply mutation
    let token = manager.apply_mutation_temporarily(test_path, "const mutated = 'content';")?;

    // Verify mutation was applied
    let current_content = fs::read_to_string(test_path)?;
    assert!(current_content.contains("mutated"));

    // Restore file
    manager.restore_file(token)?;

    // Verify restoration
    let restored_content = fs::read_to_string(test_path)?;
    assert!(restored_content.contains("original"));

    Ok(())
  }
}
