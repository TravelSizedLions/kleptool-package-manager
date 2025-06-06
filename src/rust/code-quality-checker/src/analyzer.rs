use anyhow::{anyhow, Result};
use std::fs;
use std::path::Path;
use tree_sitter::Parser;

use crate::languages::{get_function_node_types, get_language_for_extension};
use crate::metrics::{analyze_tree, Violation};

pub struct CodeAnalyzer {
    max_nesting_depth: usize,
    max_function_length: usize,
    max_complexity: usize,
}

impl CodeAnalyzer {
    pub fn new(max_nesting_depth: usize, max_function_length: usize, max_complexity: usize) -> Self {
        Self {
            max_nesting_depth,
            max_function_length,
            max_complexity,
        }
    }

    pub fn analyze_path(&self, path: &Path) -> Result<()> {
        if path.is_file() {
            self.analyze_file(path)?;
        } else if path.is_dir() {
            self.analyze_directory(path)?;
        } else {
            return Err(anyhow!("Path does not exist: {}", path.display()));
        }
        Ok(())
    }

    fn analyze_directory(&self, dir: &Path) -> Result<()> {
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            
            if path.is_dir() {
                // Skip node_modules, .git, and other common directories
                if let Some(dirname) = path.file_name() {
                    if matches!(dirname.to_str(), Some("node_modules" | ".git" | "target" | "coverage" | "dist")) {
                        continue;
                    }
                }
                self.analyze_directory(&path)?;
            } else if path.is_file() {
                // Only analyze supported file types
                if let Some(extension) = path.extension().and_then(|e| e.to_str()) {
                    if matches!(extension, "ts" | "tsx" | "js" | "jsx" | "rs" | "py" | "sh" | "bash") {
                        if let Err(e) = self.analyze_file(&path) {
                            eprintln!("Warning: Failed to analyze {}: {}", path.display(), e);
                        }
                    }
                }
            }
        }
        Ok(())
    }

    fn analyze_file(&self, file_path: &Path) -> Result<()> {
        let extension = file_path
            .extension()
            .and_then(|e| e.to_str())
            .ok_or_else(|| anyhow!("No file extension found"))?;

        let language = get_language_for_extension(extension)
            .ok_or_else(|| anyhow!("Unsupported file extension: {}", extension))?;

        let function_node_types = get_function_node_types(extension);
        
        let source_code = fs::read_to_string(file_path)?;
        
        let mut parser = Parser::new();
        parser
            .set_language(&language)
            .map_err(|e| anyhow!("Error setting language: {}", e))?;

        let tree = parser
            .parse(&source_code, None)
            .ok_or_else(|| anyhow!("Failed to parse file"))?;

        let function_metrics = analyze_tree(&tree, &source_code, &function_node_types);
        
        let mut violations = Vec::new();
        
        for metrics in function_metrics {
            // Check nesting depth
            if metrics.max_nesting_depth > self.max_nesting_depth {
                violations.push(Violation {
                    rule: "max-nesting-depth".to_string(),
                    line: metrics.start_line,
                    column: 1,
                    message: format!(
                        "Function has nesting depth {} which exceeds maximum of {}",
                        metrics.max_nesting_depth, self.max_nesting_depth
                    ),
                    actual_value: metrics.max_nesting_depth,
                    max_allowed: self.max_nesting_depth,
                });
            }
            
            // Check function length
            if metrics.length > self.max_function_length {
                violations.push(Violation {
                    rule: "max-function-length".to_string(),
                    line: metrics.start_line,
                    column: 1,
                    message: format!(
                        "Function has {} lines which exceeds maximum of {}",
                        metrics.length, self.max_function_length
                    ),
                    actual_value: metrics.length,
                    max_allowed: self.max_function_length,
                });
            }
            
            // Check cyclomatic complexity
            if metrics.cyclomatic_complexity > self.max_complexity {
                violations.push(Violation {
                    rule: "max-cyclomatic-complexity".to_string(),
                    line: metrics.start_line,
                    column: 1,
                    message: format!(
                        "Function has cyclomatic complexity {} which exceeds maximum of {}",
                        metrics.cyclomatic_complexity, self.max_complexity
                    ),
                    actual_value: metrics.cyclomatic_complexity,
                    max_allowed: self.max_complexity,
                });
            }
        }

        if !violations.is_empty() {
            println!("{}:", file_path.display());
            for violation in &violations {
                println!(
                    "  {}:{} - {} ({})",
                    violation.line, violation.column, violation.message, violation.rule
                );
            }
        }

        Ok(())
    }
} 