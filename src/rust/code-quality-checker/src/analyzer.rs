// quality-ignore max-nesting-depth file
use anyhow::{anyhow, Result};
use std::fs;
use std::path::Path;
use tree_sitter::Parser;
use std::collections::HashSet;

use crate::languages::{get_function_node_types, get_language_for_extension};
use crate::metrics::{analyze_tree, Violation};

pub struct AnalysisConfig {
    pub max_nesting_depth: usize,
    pub max_function_length: usize,
    pub max_complexity: usize,
}

#[derive(Debug, Clone, Default)]
pub struct IgnoreDirectives {
    pub file_level_ignores: HashSet<String>,
    pub file_level_overrides: std::collections::HashMap<String, usize>,
    pub function_level_ignores: std::collections::HashMap<usize, HashSet<String>>,
    pub function_level_overrides: std::collections::HashMap<usize, std::collections::HashMap<String, usize>>,
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
    let ignore_directives = __parse_ignore_directives(&source_code);
    let function_metrics = analyze_tree(&tree, &source_code, &function_node_types);
    let violations = __check_violations(&function_metrics, config, &ignore_directives);
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

fn __check_violations(
    function_metrics: &[crate::metrics::FunctionMetrics], 
    config: &AnalysisConfig,
    ignore_directives: &IgnoreDirectives
) -> Vec<Violation> {
    let mut violations = Vec::new();
    
    for metrics in function_metrics {
        __check_nesting_depth_violation(metrics, config, ignore_directives, &mut violations);
        __check_function_length_violation(metrics, config, ignore_directives, &mut violations);
        __check_complexity_violation(metrics, config, ignore_directives, &mut violations);
    }
    
    violations
}

fn __check_nesting_depth_violation(
    metrics: &crate::metrics::FunctionMetrics,
    config: &AnalysisConfig,
    ignore_directives: &IgnoreDirectives,
    violations: &mut Vec<Violation>
) {
    let rule = "max-nesting-depth";
    
    // Check if this violation should be ignored
    if __should_ignore_violation(metrics.start_line, rule, ignore_directives) {
        return;
    }
    
    // Check for override value
    let max_allowed = __get_override_value(metrics.start_line, rule, ignore_directives)
        .unwrap_or(config.max_nesting_depth);
    
    if metrics.max_nesting_depth <= max_allowed {
        return;
    }
    
    violations.push(Violation {
        rule: rule.to_string(),
        line: metrics.start_line,
        column: 1,
        message: format!(
            "Function has nesting depth {} which exceeds maximum of {}",
            metrics.max_nesting_depth, max_allowed
        ),
        actual_value: metrics.max_nesting_depth,
        max_allowed,
    });
}

fn __check_function_length_violation(
    metrics: &crate::metrics::FunctionMetrics,
    config: &AnalysisConfig,
    ignore_directives: &IgnoreDirectives,
    violations: &mut Vec<Violation>
) {
    let rule = "max-function-length";
    
    // Check if this violation should be ignored
    if __should_ignore_violation(metrics.start_line, rule, ignore_directives) {
        return;
    }
    
    // Check for override value
    let max_allowed = __get_override_value(metrics.start_line, rule, ignore_directives)
        .unwrap_or(config.max_function_length);
    
    if metrics.length <= max_allowed {
        return;
    }
    
    violations.push(Violation {
        rule: rule.to_string(),
        line: metrics.start_line,
        column: 1,
        message: format!(
            "Function has {} lines which exceeds maximum of {}",
            metrics.length, max_allowed
        ),
        actual_value: metrics.length,
        max_allowed,
    });
}

fn __check_complexity_violation(
    metrics: &crate::metrics::FunctionMetrics,
    config: &AnalysisConfig,
    ignore_directives: &IgnoreDirectives,
    violations: &mut Vec<Violation>
) {
    let rule = "max-cyclomatic-complexity";
    
    // Check if this violation should be ignored
    if __should_ignore_violation(metrics.start_line, rule, ignore_directives) {
        return;
    }
    
    // Check for override value
    let max_allowed = __get_override_value(metrics.start_line, rule, ignore_directives)
        .unwrap_or(config.max_complexity);
    
    if metrics.cyclomatic_complexity <= max_allowed {
        return;
    }
    
    violations.push(Violation {
        rule: rule.to_string(),
        line: metrics.start_line,
        column: 1,
        message: format!(
            "Function has cyclomatic complexity {} which exceeds maximum of {}",
            metrics.cyclomatic_complexity, max_allowed
        ),
        actual_value: metrics.cyclomatic_complexity,
        max_allowed,
    });
}

// quality-ignore max-nesting-depth
fn __parse_ignore_directives(source_code: &str) -> IgnoreDirectives {
    let mut directives = IgnoreDirectives::default();
    
    for (line_idx, line) in source_code.lines().enumerate() {
        let line_number = line_idx + 1; // Convert to 1-indexed
        
        // Check for quality-ignore comments
        if let Some(ignore_directive) = __parse_quality_ignore(line) {
            if ignore_directive.is_file_level {
                directives.file_level_ignores.insert(ignore_directive.rule);
            } else {
                directives.function_level_ignores
                    .entry(line_number)
                    .or_insert_with(HashSet::new)
                    .insert(ignore_directive.rule);
            }
        }
        
        // Check for quality-allow comments (overrides)
        if let Some(allow_directive) = __parse_quality_allow(line) {
            if allow_directive.is_file_level {
                directives.file_level_overrides.insert(allow_directive.rule, allow_directive.new_value);
            } else {
                directives.function_level_overrides
                    .entry(line_number)
                    .or_insert_with(std::collections::HashMap::new)
                    .insert(allow_directive.rule, allow_directive.new_value);
            }
        }
    }
    
    directives
}

#[derive(Debug)]
struct IgnoreDirective {
    rule: String,
    is_file_level: bool,
}

#[derive(Debug)]
struct AllowDirective {
    rule: String,
    new_value: usize,
    is_file_level: bool,
}

// quality-ignore max-nesting-depth
fn __parse_quality_ignore(line: &str) -> Option<IgnoreDirective> {
    let trimmed = line.trim();
    
    // Look for patterns like: // quality-ignore max-complexity
    if let Some(comment_start) = trimmed.find("//") {
        let comment = &trimmed[comment_start + 2..].trim();
        if let Some(directive_start) = comment.find("quality-ignore") {
            let directive_part = &comment[directive_start + 14..].trim(); // "quality-ignore".len() = 14
            let parts: Vec<&str> = directive_part.split_whitespace().collect();
            
            if !parts.is_empty() {
                return Some(IgnoreDirective {
                    rule: parts[0].to_string(),
                    is_file_level: parts.contains(&"file"),
                });
            }
        }
    }
    
    None
}

fn __parse_quality_allow(line: &str) -> Option<AllowDirective> {
    let trimmed = line.trim();
    
    // Look for patterns like: // quality-allow max-complexity 15 [file]
    if let Some(comment_start) = trimmed.find("//") {
        let comment = &trimmed[comment_start + 2..].trim();
        if let Some(directive_start) = comment.find("quality-allow") {
            let directive_part = &comment[directive_start + 13..].trim(); // "quality-allow".len() = 13
            let parts: Vec<&str> = directive_part.split_whitespace().collect();
            
            if parts.len() >= 2 {
                if let Ok(new_value) = parts[1].parse::<usize>() {
                    return Some(AllowDirective {
                        rule: parts[0].to_string(),
                        new_value,
                        is_file_level: parts.contains(&"file"),
                    });
                }
            }
        }
    }
    
    None
}

fn __should_ignore_violation(
    line: usize,
    rule: &str,
    ignore_directives: &IgnoreDirectives
) -> bool {
    // Check file-level ignores
    if ignore_directives.file_level_ignores.contains(rule) {
        return true;
    }
    
    // Check function-level ignores
    if let Some(function_ignores) = ignore_directives.function_level_ignores.get(&line) {
        if function_ignores.contains(rule) {
            return true;
        }
    }
    
    // Check preceding lines for function-level ignores (comment above function)
    for check_line in (line.saturating_sub(5)..line).rev() {
        if let Some(function_ignores) = ignore_directives.function_level_ignores.get(&check_line) {
            if function_ignores.contains(rule) {
                return true;
            }
        }
    }
    
    false
}

fn __get_override_value(
    line: usize,
    rule: &str,
    ignore_directives: &IgnoreDirectives
) -> Option<usize> {
    // Check function-level overrides first (highest precedence)
    if let Some(function_overrides) = ignore_directives.function_level_overrides.get(&line) {
        if let Some(&override_value) = function_overrides.get(rule) {
            return Some(override_value);
        }
    }
    
    // Check preceding lines for function-level overrides (comment above function)
    for check_line in (line.saturating_sub(5)..line).rev() {
        if let Some(function_overrides) = ignore_directives.function_level_overrides.get(&check_line) {
            if let Some(&override_value) = function_overrides.get(rule) {
                return Some(override_value);
            }
        }
    }
    
    // Check file-level overrides (lowest precedence, but still higher than default config)
    if let Some(&override_value) = ignore_directives.file_level_overrides.get(rule) {
        return Some(override_value);
    }
    
    None
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