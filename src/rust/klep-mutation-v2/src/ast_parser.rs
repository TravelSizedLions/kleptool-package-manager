use anyhow::{Context, Result};
use regex::Regex;
use std::fs;
use std::path::Path;

use crate::types::ParsedFile;

/// Regex-based TypeScript parser for mutation testing
/// Simple but reliable approach for finding mutation candidates
pub struct TypeScriptParser {
    // Compiled regex patterns for efficient matching
    binary_op_regex: Regex,
    boolean_literal_regex: Regex,
    number_literal_regex: Regex,
    string_literal_regex: Regex,
    unary_op_regex: Regex,
    assignment_op_regex: Regex,
}

impl TypeScriptParser {
    pub fn new() -> Result<Self> {
        let binary_op_regex = Regex::new(r"(?P<op>\+|\-|\*|\/|===?|!==?|>=?|<=?|&&|\|\|)").unwrap();
        let boolean_literal_regex = Regex::new(r"\b(?P<bool>true|false)\b").unwrap();
        let number_literal_regex = Regex::new(r"\b(?P<num>\d+(\.\d+)?)\b").unwrap();
        let string_literal_regex = Regex::new(r#"(?P<str>"[^"]*"|'[^']*')"#).unwrap();
        let unary_op_regex = Regex::new(r"(?P<op>!)\s*[a-zA-Z_$]").unwrap();
        let assignment_op_regex = Regex::new(r"(?P<op>\+=|\-=|\*=|\/=)").unwrap();

        Ok(TypeScriptParser {
            binary_op_regex,
            boolean_literal_regex,
            number_literal_regex,
            string_literal_regex,
            unary_op_regex,
            assignment_op_regex,
        })
    }

    /// Parse a TypeScript file, stripping comments and finding mutation candidates
    pub fn parse_file_with_ast(&mut self, file_path: &Path) -> Result<ParsedFile> {
        let content = fs::read_to_string(file_path)
            .with_context(|| format!("Failed to read file: {}", file_path.display()))?;

        let stripped_content = self.strip_comments_and_normalize(&content)?;
        
        // Create a simple "AST" structure (just the content for regex parsing)
        let simple_ast = SimpleAst {
            content: stripped_content.clone(),
        };

        Ok(ParsedFile {
            path: file_path.to_path_buf(),
            original_content: content,
            stripped_content,
            ast: simple_ast,
        })
    }

    /// Strip comments and normalize whitespace while preserving line structure
    fn strip_comments_and_normalize(&self, content: &str) -> Result<String> {
        let lines: Vec<&str> = content.lines().collect();
        let mut result = String::new();
        
        for (line_num, line) in lines.iter().enumerate() {
            let cleaned_line = self.strip_line_comments(line);
            result.push_str(&cleaned_line);
            if line_num < lines.len() - 1 {
                result.push('\n');
            }
        }

        Ok(result)
    }

    /// Strip comments from a single line while preserving string literals
    fn strip_line_comments(&self, line: &str) -> String {
        let mut result = String::new();
        let mut chars = line.chars().peekable();
        let mut in_string = false;
        let mut string_char = '"';
        let mut escaped = false;

        while let Some(ch) = chars.next() {
            match ch {
                '"' | '\'' if !escaped && !in_string => {
                    in_string = true;
                    string_char = ch;
                    result.push(ch);
                }
                ch if ch == string_char && in_string && !escaped => {
                    in_string = false;
                    result.push(ch);
                }
                '\\' if in_string => {
                    escaped = !escaped;
                    result.push(ch);
                }
                '/' if !in_string && !escaped && chars.peek() == Some(&'/') => {
                    // Single-line comment - skip rest of line
                    break;
                }
                '/' if !in_string && !escaped && chars.peek() == Some(&'*') => {
                    // Multi-line comment start - skip until end
                    chars.next(); // consume '*'
                    let mut found_end = false;
                    while let Some(comment_char) = chars.next() {
                        if comment_char == '*' && chars.peek() == Some(&'/') {
                            chars.next(); // consume '/'
                            found_end = true;
                            result.push(' '); // Replace comment with space
                            break;
                        }
                    }
                    if !found_end {
                        // Unterminated comment - this is probably an error
                        result.push_str("/* */");
                    }
                }
                _ => {
                    escaped = false;
                    result.push(ch);
                }
            }
        }

        result
    }

    /// Extract mutation opportunities using regex patterns
    pub fn extract_mutation_candidates(&self, ast: &SimpleAst, _content: &str) -> Vec<MutationCandidate> {
        let mut candidates = Vec::new();
        let content = &ast.content;

        // Find binary operators
        for mat in self.binary_op_regex.find_iter(content) {
            let original = mat.as_str().to_string();
            let mutations = self.get_binary_operator_mutations(&original);
            
            for mutated in mutations {
                candidates.push(MutationCandidate {
                    start_byte: mat.start(),
                    end_byte: mat.end(),
                    original: original.clone(),
                    mutated,
                    mutation_type: "binary_operator".to_string(),
                });
            }
        }

        // Find boolean literals
        for cap in self.boolean_literal_regex.captures_iter(content) {
            if let Some(bool_match) = cap.name("bool") {
                let original = bool_match.as_str().to_string();
                let mutated = match original.as_str() {
                    "true" => "false",
                    "false" => "true",
                    _ => continue,
                };
                
                candidates.push(MutationCandidate {
                    start_byte: bool_match.start(),
                    end_byte: bool_match.end(),
                    original,
                    mutated: mutated.to_string(),
                    mutation_type: "boolean_literal".to_string(),
                });
            }
        }

        // Find number literals
        for cap in self.number_literal_regex.captures_iter(content) {
            if let Some(num_match) = cap.name("num") {
                let original = num_match.as_str().to_string();
                if let Ok(num) = original.parse::<i64>() {
                    let mutations = vec![
                        (num + 1).to_string(),
                        if num != 0 { (num - 1).to_string() } else { "1".to_string() },
                        "0".to_string(),
                    ];
                    
                    for mutated in mutations {
                        if mutated != original {
                            candidates.push(MutationCandidate {
                                start_byte: num_match.start(),
                                end_byte: num_match.end(),
                                original: original.clone(),
                                mutated,
                                mutation_type: "number_literal".to_string(),
                            });
                        }
                    }
                }
            }
        }

        // Find string literals
        for cap in self.string_literal_regex.captures_iter(content) {
            if let Some(str_match) = cap.name("str") {
                let original = str_match.as_str().to_string();
                let mutations = vec!["\"\"".to_string(), "\"mutated\"".to_string()];
                
                for mutated in mutations {
                    if mutated != original {
                        candidates.push(MutationCandidate {
                            start_byte: str_match.start(),
                            end_byte: str_match.end(),
                            original: original.clone(),
                            mutated,
                            mutation_type: "string_literal".to_string(),
                        });
                    }
                }
            }
        }

        // Find unary operators
        for cap in self.unary_op_regex.captures_iter(content) {
            if let Some(op_match) = cap.name("op") {
                let original = op_match.as_str().to_string();
                if original == "!" {
                    candidates.push(MutationCandidate {
                        start_byte: op_match.start(),
                        end_byte: op_match.end(),
                        original,
                        mutated: "".to_string(), // Remove the negation
                        mutation_type: "unary_operator".to_string(),
                    });
                }
            }
        }

        // Find assignment operators
        for cap in self.assignment_op_regex.captures_iter(content) {
            if let Some(op_match) = cap.name("op") {
                let original = op_match.as_str().to_string();
                let mutated = match original.as_str() {
                    "+=" => "-=",
                    "-=" => "+=",
                    "*=" => "/=",
                    "/=" => "*=",
                    _ => continue,
                };
                
                candidates.push(MutationCandidate {
                    start_byte: op_match.start(),
                    end_byte: op_match.end(),
                    original,
                    mutated: mutated.to_string(),
                    mutation_type: "assignment_operator".to_string(),
                });
            }
        }

        candidates
    }

    /// Get mutations for binary operators
    fn get_binary_operator_mutations(&self, original: &str) -> Vec<String> {
        match original {
            "+" => vec!["-".to_string(), "*".to_string(), "/".to_string()],
            "-" => vec!["+".to_string(), "*".to_string(), "/".to_string()],
            "*" => vec!["+".to_string(), "-".to_string(), "/".to_string()],
            "/" => vec!["+".to_string(), "-".to_string(), "*".to_string()],
            "===" => vec!["!==".to_string(), ">=".to_string(), "<=".to_string()],
            "!==" => vec!["===".to_string(), ">".to_string(), "<".to_string()],
            ">" => vec!["<".to_string(), ">=".to_string(), "===".to_string()],
            "<" => vec![">".to_string(), "<=".to_string(), "===".to_string()],
            ">=" => vec!["<".to_string(), ">".to_string(), "===".to_string()],
            "<=" => vec![">".to_string(), "<".to_string(), "===".to_string()],
            "&&" => vec!["||".to_string()],
            "||" => vec!["&&".to_string()],
            "==" => vec!["!=".to_string()],
            "!=" => vec!["==".to_string()],
            _ => vec![],
        }
    }
}

/// Simple AST structure for regex-based parsing
#[derive(Debug, Clone)]
pub struct SimpleAst {
    pub content: String,
}

/// A mutation candidate found in the code
#[derive(Debug, Clone)]
pub struct MutationCandidate {
    pub start_byte: usize,
    pub end_byte: usize,
    pub original: String,
    pub mutated: String,
    pub mutation_type: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::NamedTempFile;
    use std::io::Write;

    #[test]
    fn test_comment_stripping() -> Result<()> {
        let parser = TypeScriptParser::new()?;
        
        let input = r#"
// This is a comment
const value = "not a // comment";
/* Multi-line
   comment */
const other = 42; // Another comment
"#;
        
        let stripped = parser.strip_comments_and_normalize(input)?;
        assert!(!stripped.contains("This is a comment"));
        assert!(stripped.contains("not a // comment")); // Should preserve in string
        assert!(!stripped.contains("Multi-line"));
        assert!(!stripped.contains("Another comment"));
        assert!(stripped.contains("const value"));
        assert!(stripped.contains("const other = 42;"));
        
        Ok(())
    }

    #[test]
    fn test_regex_parsing() -> Result<()> {
        let mut parser = TypeScriptParser::new()?;
        
        let mut temp_file = NamedTempFile::with_suffix(".ts")?;
        writeln!(temp_file, r#"
const a = 5 + 3;
const b = true;
const c = "hello";
if (flag && !other) {{}}
"#)?;
        
        let parsed = parser.parse_file_with_ast(temp_file.path())?;
        let candidates = parser.extract_mutation_candidates(&parsed.ast, &parsed.stripped_content);
        
        // Should find mutations
        assert!(!candidates.is_empty());
        
        // Should find binary operator
        assert!(candidates.iter().any(|c| c.mutation_type == "binary_operator"));
        // Should find boolean literal
        assert!(candidates.iter().any(|c| c.mutation_type == "boolean_literal"));
        
        Ok(())
    }
} 