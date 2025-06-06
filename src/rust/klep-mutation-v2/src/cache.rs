use anyhow::Result;
use dashmap::DashMap;
use lru::LruCache;
use std::num::NonZeroUsize;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

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

/// Cached test result with timestamp
#[derive(Debug, Clone)]
pub struct CachedTestResult {
    pub success: bool,
    pub output: String,
    pub cached_at: SystemTime,
    pub execution_time_ms: u64,
}

impl CachedTestResult {
    pub fn is_stale(&self, max_age: Duration) -> bool {
        self.cached_at.elapsed().unwrap_or(Duration::MAX) > max_age
    }
}

/// High-performance cache for mutation testing operations
pub struct MutationCache {
    /// Cache for baseline test results
    baseline_cache: Arc<Mutex<LruCache<PathBuf, CachedTestResult>>>,
    
    /// Cache for mutation test results keyed by content hash
    mutation_cache: Arc<DashMap<ContentHash, CachedTestResult>>,
    
    /// Cache for file content hashes to avoid re-reading
    content_hash_cache: Arc<DashMap<PathBuf, (ContentHash, SystemTime)>>,
    
    /// Cache TTL settings
    baseline_ttl: Duration,
    mutation_ttl: Duration,
}

impl MutationCache {
    pub fn new() -> Self {
        Self {
            baseline_cache: Arc::new(Mutex::new(
                LruCache::new(NonZeroUsize::new(100).unwrap())
            )),
            mutation_cache: Arc::new(DashMap::new()),
            content_hash_cache: Arc::new(DashMap::new()),
            baseline_ttl: Duration::from_secs(300), // 5 minutes
            mutation_ttl: Duration::from_secs(3600), // 1 hour
        }
    }

    /// Get cached baseline test result if valid
    pub fn get_baseline_result(&self, file: &PathBuf) -> Option<CachedTestResult> {
        let cache = self.baseline_cache.lock().ok()?;
        cache.peek(file)
            .filter(|result| !result.is_stale(self.baseline_ttl))
            .cloned()
    }

    /// Cache baseline test result
    pub fn cache_baseline_result(&self, file: PathBuf, result: CachedTestResult) {
        if let Ok(mut cache) = self.baseline_cache.lock() {
            cache.put(file, result);
        }
    }

    /// Get cached mutation test result by content hash
    pub fn get_mutation_result(&self, content_hash: &ContentHash) -> Option<CachedTestResult> {
        self.mutation_cache.get(content_hash)
            .filter(|result| !result.is_stale(self.mutation_ttl))
            .map(|result| result.clone())
    }

    /// Cache mutation test result
    pub fn cache_mutation_result(&self, content_hash: ContentHash, result: CachedTestResult) {
        self.mutation_cache.insert(content_hash, result);
    }

    /// Get content hash for file (cached)
    pub fn get_content_hash(&self, file: &PathBuf, content: &str) -> ContentHash {
        let now = SystemTime::now();
        
        // Check if we have a recent hash cached
        if let Some(entry) = self.content_hash_cache.get(file) {
            let (hash, cached_at) = entry.value();
            if cached_at.elapsed().unwrap_or(Duration::MAX) < Duration::from_secs(60) {
                return hash.clone();
            }
        }
        
        // Compute new hash
        let hash = ContentHash::from_content(content);
        self.content_hash_cache.insert(file.clone(), (hash.clone(), now));
        hash
    }

    /// Clear stale entries to prevent memory bloat
    pub fn cleanup_stale_entries(&self) {
        // Clean mutation cache
        self.mutation_cache.retain(|_, result| !result.is_stale(self.mutation_ttl));
        
        // Clean content hash cache (keep for 10 minutes)
        let content_ttl = Duration::from_secs(600);
        self.content_hash_cache.retain(|_, (_, cached_at)| {
            cached_at.elapsed().unwrap_or(Duration::MAX) < content_ttl
        });
    }

    /// Get cache statistics for debugging
    pub fn stats(&self) -> CacheStats {
        let mutation_cache_size = self.mutation_cache.len();
        let content_hash_cache_size = self.content_hash_cache.len();
        let baseline_cache_size = self.baseline_cache.lock()
            .map(|cache| cache.len())
            .unwrap_or(0);

        CacheStats {
            baseline_cache_size,
            mutation_cache_size,
            content_hash_cache_size,
        }
    }
}

#[derive(Debug, Clone)]
pub struct CacheStats {
    pub baseline_cache_size: usize,
    pub mutation_cache_size: usize,
    pub content_hash_cache_size: usize,
}

impl Default for MutationCache {
    fn default() -> Self {
        Self::new()
    }
}

/// Batch operations for maximum GPU-like parallelism
pub struct BatchProcessor;

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