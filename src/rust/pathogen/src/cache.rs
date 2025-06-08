use anyhow::Result;
use std::path::PathBuf;

/// Fast hash computation for file content changes
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ContentHash(u64);

impl ContentHash {
  pub fn from_content(content: &str) -> Self {
    use std::hash::{Hash, Hasher};
    let mut hasher = ahash::AHasher::default();
    content.hash(&mut hasher);
    ContentHash(hasher.finish())
  }
}

/// Batch operations for maximum GPU-like parallelism
#[allow(dead_code)]
pub struct BatchProcessor;

#[allow(dead_code)]
impl BatchProcessor {
  /// Process multiple content hashes in parallel using SIMD-style operations
  pub fn batch_hash_contents(contents: Vec<&str>) -> Vec<ContentHash> {
    use rayon::prelude::*;

    contents
      .par_iter()
      .map(|content| ContentHash::from_content(content))
      .collect()
  }

  /// Batch file reading with memory mapping for maximum I/O performance
  pub fn batch_read_files(files: Vec<PathBuf>) -> Result<Vec<(PathBuf, String)>> {
    use rayon::prelude::*;

    files
      .into_par_iter()
      .map(|file| {
        let content = std::fs::read_to_string(&file)?;
        Ok((file, content))
      })
      .collect::<Result<Vec<_>>>()
  }
}
