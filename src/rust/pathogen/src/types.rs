use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// Configuration for mutation testing
#[derive(Debug, Clone)]
pub struct MutationConfig {
  pub source_dir: PathBuf,
  pub parallel_count: usize,
  pub output_file: Option<PathBuf>,
  pub verbose: bool,
  pub dry_run: bool,
  pub no_cache: bool,
  pub language: Language,
}

impl MutationConfig {
  pub fn from_args(matches: &clap::ArgMatches) -> Result<Self> {
    let source_dir = PathBuf::from(matches.get_one::<String>("source").unwrap());
    let parallel_count = matches
      .get_one::<String>("parallel")
      .map(|s| s.parse::<usize>())
      .transpose()?
      .unwrap_or_else(|| {
        std::thread::available_parallelism()
          .map(|n| n.get())
          .unwrap_or(4)
      });

    let output_file = matches.get_one::<String>("output").map(PathBuf::from);

    let verbose = matches.get_flag("verbose");
    let dry_run = matches.get_flag("dry-run");
    let no_cache = matches.get_flag("no-cache");

    // Auto-detect language from source directory
    let language = detect_language_from_directory(&source_dir)?;

    Ok(MutationConfig {
      source_dir,
      parallel_count,
      output_file,
      verbose,
      dry_run,
      no_cache,
      language,
    })
  }
}

fn detect_language_from_directory(dir: &PathBuf) -> anyhow::Result<Language> {
  let extension_counts = __count_file_extensions(dir)?;
  __determine_primary_language(&extension_counts)
}

fn __count_file_extensions(dir: &PathBuf) -> anyhow::Result<HashMap<String, usize>> {
  let mut extension_counts = HashMap::new();

  for entry in walkdir::WalkDir::new(dir)
    .into_iter()
    .filter_map(|e| e.ok())
    .filter(|e| e.file_type().is_file())
  {
    __process_directory_entry(&entry, &mut extension_counts);
  }

  Ok(extension_counts)
}

fn __process_directory_entry(
  entry: &walkdir::DirEntry,
  extension_counts: &mut HashMap<String, usize>,
) {
  if let Some(extension) = __extract_file_extension(entry.path()) {
    *extension_counts.entry(extension).or_insert(0) += 1;
  }
}

fn __extract_file_extension(path: &Path) -> Option<String> {
  path
    .extension()
    .and_then(|ext| ext.to_str())
    .map(|s| s.to_lowercase())
}

fn __determine_primary_language(
  extension_counts: &HashMap<String, usize>,
) -> anyhow::Result<Language> {
  let ts_count = extension_counts.get("ts").unwrap_or(&0);
  let js_count = extension_counts.get("js").unwrap_or(&0);
  let rs_count = extension_counts.get("rs").unwrap_or(&0);

  if *rs_count > *ts_count && *rs_count > *js_count {
    Ok(Language::Rust)
  } else if *ts_count > 0 || *js_count > 0 {
    Ok(Language::TypeScript)
  } else {
    anyhow::bail!("Could not detect primary language from source directory")
  }
}

/// A single mutation to be applied
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Mutation {
  pub id: String,
  pub file: PathBuf,
  pub line: usize,
  pub column: usize,
  pub span_start: u32,
  pub span_end: u32,
  pub original: String,
  pub mutated: String,
  pub mutation_type: MutationType,
  pub description: String,
  pub language: Language,
}

/// Types of mutations that can be applied
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum MutationType {
  // Arithmetic operators
  ArithmeticOperator,
  // Comparison operators
  ComparisonOperator,
  // Logical operators
  LogicalOperator,
  // Boolean literals
  BooleanLiteral,
  // Number literals
  NumberLiteral,
  // String literals
  StringLiteral,
  // Array methods
  ArrayMethod,
  // Object property access
  PropertyAccess,
  // Function calls
  FunctionCall,
  // Conditional expressions
  ConditionalExpression,
  // Return statements
  ReturnStatement,
  // Variable declarations
  VariableDeclaration,
  // Assignment operators
  AssignmentOperator,
  // Unary operators
  UnaryOperator,
  // Type annotations (TypeScript-specific)
  TypeAnnotation,
}

/// Result of running a mutation test
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MutationResult {
  pub mutation: Mutation,
  pub killed: bool,
  pub kill_type: KillType,
  pub test_output: String,
  pub execution_time_ms: u64,
}

/// Classification of how a mutation was killed
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum KillType {
  /// Tests passed, mutation survived
  Survived,
  /// Tests failed due to changed behavior (good!)
  BehavioralKill,
  /// Mutation caused compilation/syntax error
  CompileError,
}

/// Overall statistics for mutation testing run
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MutationStats {
  pub total_mutations: usize,
  pub behavioral_kills: usize,
  pub compile_errors: usize,
  pub survived: usize,
  pub duration: f64,
  pub files_tested: usize,
  pub per_file_stats: Vec<FileStats>,
}

/// Per-file mutation testing statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileStats {
  pub file_path: String,
  pub total_mutations: usize,
  pub behavioral_kills: usize,
  pub compile_errors: usize,
  pub survived: usize,
  pub kill_rate: f64,
  pub survived_mutations: Vec<Mutation>,
}

/// Programming language support
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Language {
  TypeScript,
  Rust,
}

impl Language {
  pub fn extension(&self) -> &'static str {
    match self {
      Language::TypeScript => "ts",
      Language::Rust => "rs",
    }
  }

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
