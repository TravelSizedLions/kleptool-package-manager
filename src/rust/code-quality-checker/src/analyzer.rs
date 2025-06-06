use anyhow::{anyhow, Result};
use std::fs;
use std::path::Path;
use tree_sitter::Parser;

use crate::languages::{get_function_node_types, get_language_for_extension};
use crate::metrics::{analyze_tree, Violation};

pub struct AnalysisConfig {
    pub max_nesting_depth: usize,
    pub max_function_length: usize,
    pub max_complexity: usize,
}

pub fn analyze_path(path: &Path, config: &AnalysisConfig) -> Result<()> {
    if !path.exists() {
        return Err(anyhow!("Path does not exist: {}", path.display()));
    }
    
    if path.is_file() {
        return analyze_file(path, config);
    }
    
    if path.is_dir() {
        return analyze_directory(path, config);
    }
    
    Err(anyhow!("Path is neither file nor directory: {}", path.display()))
}

fn analyze_directory(dir: &Path, config: &AnalysisConfig) -> Result<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        
        if path.is_dir() {
            if __should_skip_directory(&path) {
                continue;
            }
            analyze_directory(&path, config)?;
            continue;
        }
        
        if path.is_file() {
            __try_analyze_file(&path, config);
        }
    }
    Ok(())
}

fn analyze_file(file_path: &Path, config: &AnalysisConfig) -> Result<()> {
    let extension = __get_file_extension(file_path)?;
    let language = __get_language_for_file(extension)?;
    let function_node_types = get_function_node_types(extension);
    let source_code = fs::read_to_string(file_path)?;
    let tree = __parse_source_code(&source_code, &language)?;
    let function_metrics = analyze_tree(&tree, &source_code, &function_node_types);
    let violations = __check_violations(&function_metrics, config);
    __print_violations(file_path, &violations);
    Ok(())
}

fn __should_skip_directory(path: &Path) -> bool {
    let Some(dirname) = path.file_name() else {
        return false;
    };
    
    matches!(dirname.to_str(), Some("node_modules" | ".git" | "target" | "coverage" | "dist"))
}

fn __try_analyze_file(path: &Path, config: &AnalysisConfig) {
    let Some(extension) = path.extension().and_then(|e| e.to_str()) else {
        return;
    };
    
    if !__is_supported_extension(extension) {
        return;
    }
    
    if let Err(e) = analyze_file(path, config) {
        eprintln!("Warning: Failed to analyze {}: {}", path.display(), e);
    }
}

fn __is_supported_extension(extension: &str) -> bool {
    matches!(extension, "ts" | "tsx" | "js" | "jsx" | "rs" | "py" | "sh" | "bash")
}

fn __get_file_extension(file_path: &Path) -> Result<&str> {
    file_path
        .extension()
        .and_then(|e| e.to_str())
        .ok_or_else(|| anyhow!("No file extension found"))
}

fn __get_language_for_file(extension: &str) -> Result<tree_sitter::Language> {
    get_language_for_extension(extension)
        .ok_or_else(|| anyhow!("Unsupported file extension: {}", extension))
}

fn __parse_source_code(source_code: &str, language: &tree_sitter::Language) -> Result<tree_sitter::Tree> {
    let mut parser = Parser::new();
    parser
        .set_language(language)
        .map_err(|e| anyhow!("Error setting language: {}", e))?;

    parser
        .parse(source_code, None)
        .ok_or_else(|| anyhow!("Failed to parse file"))
}

fn __check_violations(function_metrics: &[crate::metrics::FunctionMetrics], config: &AnalysisConfig) -> Vec<Violation> {
    let mut violations = Vec::new();
    
    for metrics in function_metrics {
        __check_nesting_depth_violation(metrics, config, &mut violations);
        __check_function_length_violation(metrics, config, &mut violations);
        __check_complexity_violation(metrics, config, &mut violations);
    }
    
    violations
}

fn __check_nesting_depth_violation(
    metrics: &crate::metrics::FunctionMetrics,
    config: &AnalysisConfig,
    violations: &mut Vec<Violation>
) {
    if metrics.max_nesting_depth <= config.max_nesting_depth {
        return;
    }
    
    violations.push(Violation {
        rule: "max-nesting-depth".to_string(),
        line: metrics.start_line,
        column: 1,
        message: format!(
            "Function has nesting depth {} which exceeds maximum of {}",
            metrics.max_nesting_depth, config.max_nesting_depth
        ),
        actual_value: metrics.max_nesting_depth,
        max_allowed: config.max_nesting_depth,
    });
}

fn __check_function_length_violation(
    metrics: &crate::metrics::FunctionMetrics,
    config: &AnalysisConfig,
    violations: &mut Vec<Violation>
) {
    if metrics.length <= config.max_function_length {
        return;
    }
    
    violations.push(Violation {
        rule: "max-function-length".to_string(),
        line: metrics.start_line,
        column: 1,
        message: format!(
            "Function has {} lines which exceeds maximum of {}",
            metrics.length, config.max_function_length
        ),
        actual_value: metrics.length,
        max_allowed: config.max_function_length,
    });
}

fn __check_complexity_violation(
    metrics: &crate::metrics::FunctionMetrics,
    config: &AnalysisConfig,
    violations: &mut Vec<Violation>
) {
    if metrics.cyclomatic_complexity <= config.max_complexity {
        return;
    }
    
    violations.push(Violation {
        rule: "max-cyclomatic-complexity".to_string(),
        line: metrics.start_line,
        column: 1,
        message: format!(
            "Function has cyclomatic complexity {} which exceeds maximum of {}",
            metrics.cyclomatic_complexity, config.max_complexity
        ),
        actual_value: metrics.cyclomatic_complexity,
        max_allowed: config.max_complexity,
    });
}

fn __print_violations(file_path: &Path, violations: &[Violation]) {
    if violations.is_empty() {
        return;
    }
    
    println!("{}:", file_path.display());
    for violation in violations {
        println!(
            "  {}:{} - {} ({})",
            violation.line, violation.column, violation.message, violation.rule
        );
    }
} 