use anyhow::Result;

use crate::ast_parser::{MutationCandidate, TypeScriptParser};
use crate::types::{MutationContext, MutationType, ParsedFile};

/// AST-based mutation engine that generates semantically-aware mutations
/// by traversing the TypeScript AST using tree-sitter
pub struct MutationEngine {
  parser: TypeScriptParser,
}

impl MutationEngine {
  pub fn new() -> Result<Self> {
    let parser = TypeScriptParser::new()?;
    Ok(MutationEngine { parser })
  }

  /// Generate mutations by traversing the AST and identifying mutation opportunities
  pub fn generate_ast_mutations(&self, parsed_file: &ParsedFile) -> Vec<crate::types::Mutation> {
    let mut context = MutationContext::new(parsed_file);

    // Extract mutation candidates from the tree-sitter AST
    let candidates = self
      .parser
      .extract_mutation_candidates(&parsed_file.ast, &parsed_file.stripped_content);

    // Convert candidates to mutations
    for candidate in candidates {
      let mutation_type = self.classify_mutation_type(&candidate);

      if let Err(e) = context.add_mutation_from_candidate(&candidate, mutation_type) {
        eprintln!("Failed to add mutation: {}", e);
      }
    }

    context.into_mutations()
  }

  /// Classify the mutation type based on the candidate
  fn classify_mutation_type(&self, candidate: &MutationCandidate) -> MutationType {
    match candidate.mutation_type.as_str() {
      "binary_operator" => self.classify_binary_operator(&candidate.original),
      "boolean_literal" => MutationType::BooleanLiteral,
      "number_literal" => MutationType::NumberLiteral,
      "string_literal" => MutationType::StringLiteral,
      "unary_operator" => MutationType::UnaryOperator,
      "assignment_operator" => MutationType::AssignmentOperator,
      "method_call" => MutationType::ArrayMethod,
      _ => MutationType::PropertyAccess, // Default fallback
    }
  }

  /// Classify binary operator mutations
  fn classify_binary_operator(&self, original: &str) -> MutationType {
    if self.is_arithmetic_operator(original) {
      MutationType::ArithmeticOperator
    } else if self.is_comparison_operator(original) {
      MutationType::ComparisonOperator
    } else if self.is_logical_operator(original) {
      MutationType::LogicalOperator
    } else {
      MutationType::ArithmeticOperator // Default fallback
    }
  }

  /// Check if operator is arithmetic
  fn is_arithmetic_operator(&self, op: &str) -> bool {
    matches!(op, "+" | "-" | "*" | "/" | "%")
  }

  /// Check if operator is comparison
  fn is_comparison_operator(&self, op: &str) -> bool {
    matches!(op, "===" | "!==" | ">" | "<" | ">=" | "<=" | "==" | "!=")
  }

  /// Check if operator is logical
  fn is_logical_operator(&self, op: &str) -> bool {
    matches!(op, "&&" | "||")
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::io::Write;
  use tempfile::NamedTempFile;

  #[test]
  fn test_mutation_engine_creation() -> Result<()> {
    let _engine = MutationEngine::new()?;
    Ok(())
  }

  #[test]
  fn test_binary_operator_mutations() -> Result<()> {
    let mut parser = crate::ast_parser::TypeScriptParser::new()?;
    let engine = MutationEngine::new()?;

    let mut temp_file = NamedTempFile::with_suffix(".ts")?;
    writeln!(
      temp_file,
      r#"
const a = 5 + 3;
const b = 10 - 2;
const c = a === b;
const d = c && true;
"#
    )?;

    let parsed = parser.parse_file_with_ast(temp_file.path())?;
    let mutations = engine.generate_ast_mutations(&parsed);

    // Should generate some mutations
    assert!(!mutations.is_empty());

    println!("Generated {} mutations:", mutations.len());
    for mutation in &mutations {
      println!(
        "  {} -> {} ({})",
        mutation.original,
        mutation.mutated,
        mutation.mutation_type.description()
      );
    }

    Ok(())
  }

  #[test]
  fn test_literal_mutations() -> Result<()> {
    let mut parser = crate::ast_parser::TypeScriptParser::new()?;
    let engine = MutationEngine::new()?;

    let mut temp_file = NamedTempFile::with_suffix(".ts")?;
    writeln!(
      temp_file,
      r#"
const flag = true;
const count = 42;
const message = "hello";
"#
    )?;

    let parsed = parser.parse_file_with_ast(temp_file.path())?;
    let mutations = engine.generate_ast_mutations(&parsed);

    // Should have mutations for literals
    assert!(!mutations.is_empty());

    // Check for boolean, number, and string mutations
    let has_boolean = mutations
      .iter()
      .any(|m| matches!(m.mutation_type, MutationType::BooleanLiteral));
    let has_number = mutations
      .iter()
      .any(|m| matches!(m.mutation_type, MutationType::NumberLiteral));
    let has_string = mutations
      .iter()
      .any(|m| matches!(m.mutation_type, MutationType::StringLiteral));

    println!("Has boolean mutations: {}", has_boolean);
    println!("Has number mutations: {}", has_number);
    println!("Has string mutations: {}", has_string);

    Ok(())
  }
}
