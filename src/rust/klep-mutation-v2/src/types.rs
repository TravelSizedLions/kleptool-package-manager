use anyhow::{Context, Result};
use clap::ArgMatches;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use crate::ast_parser::SimpleAst;

/// Configuration for mutation testing run
#[derive(Debug, Clone)]
pub struct MutationConfig {
    pub source_dir: PathBuf,
    pub parallel_count: usize,
    pub output_file: Option<PathBuf>,
    pub verbose: bool,
    pub dry_run: bool,
}

impl MutationConfig {
    pub fn from_args(matches: &ArgMatches) -> Result<Self> {
        let source_dir = PathBuf::from(matches.get_one::<String>("source").unwrap());
        let parallel_count: usize = matches
            .get_one::<String>("parallel")
            .unwrap()
            .parse()
            .context("Invalid parallel count")?;
        let output_file = matches.get_one::<String>("output").map(PathBuf::from);
        let verbose = matches.get_flag("verbose");
        let dry_run = matches.get_flag("dry-run");

        Ok(MutationConfig {
            source_dir,
            parallel_count,
            output_file,
            verbose,
            dry_run,
        })
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
#[derive(Debug, Clone, Serialize, Deserialize)]
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
        // Calculate line/column from byte position in the content
        let content_up_to_start = &self.file.stripped_content[..candidate.start_byte.min(self.file.stripped_content.len())];
        let line = content_up_to_start.lines().count();
        let column = content_up_to_start.lines().last().map_or(0, |last_line| last_line.len());

        let mutation = Mutation {
            id: format!("{}_{}", self.file.path.display(), self.mutation_counter),
            file: self.file.path.clone(),
            line,
            column,
            span_start: candidate.start_byte as u32,
            span_end: candidate.end_byte as u32,
            original: candidate.original.clone(),
            mutated: candidate.mutated.clone(),
            description: format!("{} at {}:{}", mutation_type.description(), line, column),
            mutation_type,
        };

        self.mutations.push(mutation);
        self.mutation_counter += 1;
        
        Ok(())
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
            vec![
                (num + 1).to_string(),
                if num != 0 { (num - 1).to_string() } else { "1".to_string() },
                "0".to_string(),
                if num != 1 { "1".to_string() } else { "2".to_string() },
            ]
        } else if let Ok(num) = original.parse::<f64>() {
            vec![
                (num + 1.0).to_string(),
                (num - 1.0).to_string(),
                "0.0".to_string(),
                "1.0".to_string(),
            ]
        } else {
            vec![]
        }
    }

    /// Create string literal mutations
    pub fn string_mutations(original: &str) -> Vec<String> {
        vec![
            "\"\"".to_string(),                    // Empty string
            "\"mutated\"".to_string(),             // Generic replacement
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
        assert_eq!(MutationBuilder::boolean_mutations("true"), vec!["false".to_string()]);
        assert_eq!(MutationBuilder::boolean_mutations("false"), vec!["true".to_string()]);
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