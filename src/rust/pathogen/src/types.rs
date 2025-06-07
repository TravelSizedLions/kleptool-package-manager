use crate::ast_parser::SimpleAst;
use anyhow::{Context, Result};
use clap::ArgMatches;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::collections::HashMap;

/// Configuration for mutation testing run
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
  pub fn from_args(matches: &ArgMatches) -> Result<Self> {
    let source_dir = PathBuf::from(matches.get_one::<String>("source").unwrap());
    
    // Auto-detect language from source directory
    let language = detect_language_from_directory(&source_dir)?;
    
    let parallel_count = match matches.get_one::<String>("parallel") {
      Some(p) => p.parse::<usize>()
        .map_err(|_| anyhow::anyhow!("Invalid parallel count: {}", p))?,
      None => std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(1),
    };

    let output_file = matches.get_one::<String>("output").map(PathBuf::from);
    let verbose = matches.get_flag("verbose");
    let dry_run = matches.get_flag("dry-run");
    let no_cache = matches.get_flag("no-cache");

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
    // Count files by extension to determine primary language
    let mut extension_counts: HashMap<String, usize> = HashMap::new();
    
    if dir.exists() && dir.is_dir() {
        for entry in std::fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            
            if path.is_file() {
                if let Some(extension) = path.extension().and_then(|ext| ext.to_str()) {
                    *extension_counts.entry(extension.to_string()).or_insert(0) += 1;
                }
            }
        }
    }
    
    // Determine language based on file counts
    let ts_count = extension_counts.get("ts").unwrap_or(&0);
    let rs_count = extension_counts.get("rs").unwrap_or(&0);
    
    if rs_count > ts_count {
        Ok(Language::Rust)
    } else if ts_count > &0 {
        Ok(Language::TypeScript)
    } else {
        // Default to TypeScript if no files found (backwards compatibility)
        Ok(Language::TypeScript)
    }
}

/// A parsed TypeScript file with AST and metadata
#[derive(Debug)]
pub struct ParsedFile {
  pub path: PathBuf,
  pub original_content: String,
  pub stripped_content: String,
  pub ast: SimpleAst,
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

impl MutationType {
  // quality-allow max-cyclomatic-complexity 20
  pub fn description(&self) -> &'static str {
    match self {
      MutationType::ArithmeticOperator => "Arithmetic operator mutation",
      MutationType::ComparisonOperator => "Comparison operator mutation",
      MutationType::LogicalOperator => "Logical operator mutation",
      MutationType::BooleanLiteral => "Boolean literal mutation",
      MutationType::NumberLiteral => "Number literal mutation",
      MutationType::StringLiteral => "String literal mutation",
      MutationType::ArrayMethod => "Array method mutation",
      MutationType::PropertyAccess => "Property access mutation",
      MutationType::FunctionCall => "Function call mutation",
      MutationType::ConditionalExpression => "Conditional expression mutation",
      MutationType::ReturnStatement => "Return statement mutation",
      MutationType::VariableDeclaration => "Variable declaration mutation",
      MutationType::AssignmentOperator => "Assignment operator mutation",
      MutationType::UnaryOperator => "Unary operator mutation",
      MutationType::TypeAnnotation => "Type annotation mutation",
    }
  }
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

/// Context for generating mutations from AST nodes
#[derive(Debug)]
pub struct MutationContext<'a> {
  pub file: &'a ParsedFile,
  pub mutations: Vec<Mutation>,
  pub mutation_counter: usize,
}

impl<'a> MutationContext<'a> {
  pub fn new(file: &'a ParsedFile) -> Self {
    MutationContext {
      file,
      mutations: Vec::new(),
      mutation_counter: 0,
    }
  }

  /// Add a mutation to the context from tree-sitter data
  pub fn add_mutation_from_candidate(
    &mut self,
    candidate: &crate::ast_parser::MutationCandidate,
    mutation_type: MutationType,
  ) -> Result<()> {
    let (line, column) = self.calculate_position(candidate.start_byte);
    let mutation = self.build_mutation(candidate, mutation_type, line, column);
    self.add_mutation(mutation);
    Ok(())
  }

  /// Calculate line and column from byte position
  fn calculate_position(&self, start_byte: usize) -> (usize, usize) {
    let content_up_to_start =
      &self.file.stripped_content[..start_byte.min(self.file.stripped_content.len())];
    let line = content_up_to_start.lines().count();
    let column = content_up_to_start
      .lines()
      .last()
      .map_or(0, |last_line| last_line.len());
    (line, column)
  }

  /// Build a mutation object from components
  fn build_mutation(
    &self,
    candidate: &crate::ast_parser::MutationCandidate,
    mutation_type: MutationType,
    line: usize,
    column: usize,
  ) -> Mutation {
    // Detect language from file extension
    let language = self.file.path.extension()
      .and_then(|ext| ext.to_str())
      .and_then(Language::detect_from_extension)
      .unwrap_or(Language::TypeScript); // Default to TypeScript for backwards compatibility
    
    Mutation {
      id: self.generate_mutation_id(),
      file: self.file.path.clone(),
      line,
      column,
      span_start: candidate.start_byte as u32,
      span_end: candidate.end_byte as u32,
      original: candidate.original.clone(),
      mutated: candidate.mutated.clone(),
      description: self.generate_description(&mutation_type, line, column),
      mutation_type,
      language,
    }
  }

  /// Generate a unique mutation ID
  fn generate_mutation_id(&self) -> String {
    format!("{}_{}", self.file.path.display(), self.mutation_counter)
  }

  /// Generate a description for the mutation
  fn generate_description(
    &self,
    mutation_type: &MutationType,
    line: usize,
    column: usize,
  ) -> String {
    format!("{} at {}:{}", mutation_type.description(), line, column)
  }

  /// Add a mutation to the context
  fn add_mutation(&mut self, mutation: Mutation) {
    self.mutations.push(mutation);
    self.mutation_counter += 1;
  }

  /// Get all mutations generated
  pub fn into_mutations(self) -> Vec<Mutation> {
    self.mutations
  }
}

/// Helper for creating specific types of mutations
pub struct MutationBuilder;

impl MutationBuilder {
  /// Create arithmetic operator mutations
  pub fn arithmetic_mutations(original: &str) -> Vec<String> {
    match original {
      "+" => vec!["-".to_string(), "*".to_string(), "/".to_string()],
      "-" => vec!["+".to_string(), "*".to_string(), "/".to_string()],
      "*" => vec!["+".to_string(), "-".to_string(), "/".to_string()],
      "/" => vec!["+".to_string(), "-".to_string(), "*".to_string()],
      "%" => vec!["+".to_string(), "-".to_string(), "*".to_string()],
      _ => vec![],
    }
  }

  /// Create comparison operator mutations
  // quality-allow max-cyclomatic-complexity 15
  pub fn comparison_mutations(original: &str) -> Vec<String> {
    match original {
      "===" => vec!["!==".to_string(), ">=".to_string(), "<=".to_string()],
      "!==" => vec!["===".to_string(), ">".to_string(), "<".to_string()],
      ">" => vec!["<".to_string(), ">=".to_string(), "===".to_string()],
      "<" => vec![">".to_string(), "<=".to_string(), "===".to_string()],
      ">=" => vec!["<".to_string(), ">".to_string(), "===".to_string()],
      "<=" => vec![">".to_string(), "<".to_string(), "===".to_string()],
      "==" => vec!["!=".to_string(), ">".to_string(), "<".to_string()],
      "!=" => vec!["==".to_string(), ">".to_string(), "<".to_string()],
      _ => vec![],
    }
  }

  /// Create logical operator mutations
  pub fn logical_mutations(original: &str) -> Vec<String> {
    match original {
      "&&" => vec!["||".to_string()],
      "||" => vec!["&&".to_string()],
      "!" => vec!["".to_string()], // Remove negation
      _ => vec![],
    }
  }

  /// Create boolean literal mutations
  pub fn boolean_mutations(original: &str) -> Vec<String> {
    match original {
      "true" => vec!["false".to_string()],
      "false" => vec!["true".to_string()],
      _ => vec![],
    }
  }

  /// Create number literal mutations
  pub fn number_mutations(original: &str) -> Vec<String> {
    if let Ok(num) = original.parse::<i64>() {
      Self::integer_mutations(num)
    } else if let Ok(num) = original.parse::<f64>() {
      Self::float_mutations(num)
    } else {
      vec![]
    }
  }

  /// Create mutations for integer numbers
  fn integer_mutations(num: i64) -> Vec<String> {
    vec![
      (num + 1).to_string(),
      Self::integer_decrement_mutation(num),
      "0".to_string(),
      Self::integer_one_mutation(num),
    ]
  }

  /// Create mutations for floating point numbers
  fn float_mutations(num: f64) -> Vec<String> {
    vec![
      (num + 1.0).to_string(),
      (num - 1.0).to_string(),
      "0.0".to_string(),
      "1.0".to_string(),
    ]
  }

  /// Generate decrement mutation for integers
  fn integer_decrement_mutation(num: i64) -> String {
    if num != 0 {
      (num - 1).to_string()
    } else {
      "1".to_string()
    }
  }

  /// Generate "1" mutation for integers, avoiding duplicates
  fn integer_one_mutation(num: i64) -> String {
    if num != 1 {
      "1".to_string()
    } else {
      "2".to_string()
    }
  }

  /// Create string literal mutations
  pub fn string_mutations(original: &str) -> Vec<String> {
    vec![
      "\"\"".to_string(),                             // Empty string
      "\"mutated\"".to_string(),                      // Generic replacement
      format!("\"{}X\"", original.trim_matches('"')), // Append character
    ]
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_mutation_builder_arithmetic() {
    let mutations = MutationBuilder::arithmetic_mutations("+");
    assert!(mutations.contains(&"-".to_string()));
    assert!(mutations.contains(&"*".to_string()));
    assert!(mutations.contains(&"/".to_string()));
  }

  #[test]
  fn test_mutation_builder_comparison() {
    let mutations = MutationBuilder::comparison_mutations("===");
    assert!(mutations.contains(&"!==".to_string()));
    assert!(mutations.contains(&">=".to_string()));
    assert!(mutations.contains(&"<=".to_string()));
  }

  #[test]
  fn test_mutation_builder_boolean() {
    assert_eq!(
      MutationBuilder::boolean_mutations("true"),
      vec!["false".to_string()]
    );
    assert_eq!(
      MutationBuilder::boolean_mutations("false"),
      vec!["true".to_string()]
    );
  }

  #[test]
  fn test_number_mutations() {
    let mutations = MutationBuilder::number_mutations("5");
    assert!(mutations.contains(&"6".to_string()));
    assert!(mutations.contains(&"4".to_string()));
    assert!(mutations.contains(&"0".to_string()));
    assert!(mutations.contains(&"1".to_string()));
  }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum Language {
    TypeScript,
    Rust,
}

impl Language {
    pub fn detect_from_extension(extension: &str) -> Option<Self> {
        match extension {
            "ts" => Some(Language::TypeScript),
            "rs" => Some(Language::Rust),
            _ => None,
        }
    }
    
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
    
    pub fn get_file_pattern(&self) -> &'static str {
        match self {
            Language::TypeScript => "*.ts",
            Language::Rust => "*.rs",
        }
    }
}
