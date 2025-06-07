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
    }
    // Auto-restore completed silently for clean output
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
  use sha256;

  #[test]
  fn test_file_safety_basic_operations() -> Result<()> {
    let mut manager = SafeFileManager::new()?;
    let temp_dir = tempfile::TempDir::new()?;
    let test_file = temp_dir.path().join("test.ts");
    
    // Create test file with original content
    let original_content = "const x = 5;";
    fs::write(&test_file, original_content)?;
    
    // Prepare file for mutation
    let temp_copy = manager.prepare_file_for_mutation(&test_file)?;
    assert!(temp_copy.exists());
    
    // Apply mutation temporarily
    let mutated_content = "const x = 999;";
    let token = manager.apply_mutation_temporarily(&test_file, mutated_content)?;
    
    // Verify mutation was applied
    let current_content = fs::read_to_string(&test_file)?;
    assert_eq!(current_content, mutated_content);
    
    // Restore file
    manager.restore_file(token)?;
    
    // Verify original content is restored
    let restored_content = fs::read_to_string(&test_file)?;
    assert_eq!(restored_content, original_content);
    
    Ok(())
  }

  #[test]
  fn test_mutation_leak_protection() -> Result<()> {
    let mut manager = SafeFileManager::new()?;
    let temp_dir = tempfile::TempDir::new()?;
    let test_file = temp_dir.path().join("mutation_leak_test.ts");
    
    // Create test file
    let original_content = "https://github.com/username/repository.git";
    fs::write(&test_file, original_content)?;
    
    // Record original content hash
    let original_hash = sha256::digest(original_content);
    
    // Prepare for mutation
    manager.prepare_file_for_mutation(&test_file)?;
    
    // Apply problematic mutation (like the one that leaked)
    let mutated_content = "https:/*github.com/username/repository.git";
    let token = manager.apply_mutation_temporarily(&test_file, mutated_content)?;
    
    // Verify mutation is applied
    let current_content = fs::read_to_string(&test_file)?;
    assert_eq!(current_content, mutated_content);
    
    // Restore immediately
    manager.restore_file(token)?;
    
    // CRITICAL: Verify no mutation leaked
    let final_content = fs::read_to_string(&test_file)?;
    let final_hash = sha256::digest(&final_content);
    
    assert_eq!(final_content, original_content, "Mutation leaked! Content changed permanently");
    assert_eq!(final_hash, original_hash, "File hash changed - mutation may have leaked");
    
    Ok(())
  }

  #[test]
  fn test_emergency_restoration() -> Result<()> {
    let mut manager = SafeFileManager::new()?;
    let temp_dir = tempfile::TempDir::new()?;
    let test_file = temp_dir.path().join("emergency_test.ts");
    
    let original_content = "const safe = true;";
    fs::write(&test_file, original_content)?;
    
    manager.prepare_file_for_mutation(&test_file)?;
    
    // Apply mutation but DON'T restore normally (simulate failure)
    let mutated_content = "const safe = false;";
    let _token = manager.apply_mutation_temporarily(&test_file, mutated_content)?;
    // Intentionally drop token without restoring
    
    // Emergency restore
    manager.emergency_restore_all()?;
    
    // Verify restoration worked
    let restored_content = fs::read_to_string(&test_file)?;
    assert_eq!(restored_content, original_content);
    
    Ok(())
  }

  #[test]
  fn test_auto_restore_on_token_drop() -> Result<()> {
    let mut manager = SafeFileManager::new()?;
    let temp_dir = tempfile::TempDir::new()?;
    let test_file = temp_dir.path().join("auto_restore_test.ts");
    
    let original_content = "const auto = 'restore';";
    fs::write(&test_file, original_content)?;
    
    manager.prepare_file_for_mutation(&test_file)?;
    
    {
      // Apply mutation in limited scope
      let mutated_content = "const auto = 'MUTATED';";
      let _token = manager.apply_mutation_temporarily(&test_file, mutated_content)?;
      
      // Verify mutation applied
      let current_content = fs::read_to_string(&test_file)?;
      assert_eq!(current_content, mutated_content);
      
      // Token will be dropped here, triggering auto-restore
    }
    
    // Give a moment for Drop to execute
    std::thread::sleep(std::time::Duration::from_millis(10));
    
    // Verify auto-restoration worked
    let restored_content = fs::read_to_string(&test_file)?;
    assert_eq!(restored_content, original_content);
    
    Ok(())
  }
}
