use serde::{Deserialize, Serialize};
use tree_sitter::{Node, Tree, TreeCursor};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeMetrics {
    pub file_path: String,
    pub violations: Vec<Violation>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Violation {
    pub rule: String,
    pub line: usize,
    pub column: usize,
    pub message: String,
    pub actual_value: usize,
    pub max_allowed: usize,
}

#[derive(Debug, Clone)]
pub struct FunctionMetrics {
    pub start_line: usize,
    pub end_line: usize,
    pub length: usize,
    pub max_nesting_depth: usize,
}

pub fn analyze_tree(tree: &Tree, source_code: &str, function_node_types: &[&str]) -> Vec<FunctionMetrics> {
    let mut functions = Vec::new();
    let mut cursor = tree.walk();
    
    __find_functions(&mut cursor, source_code, function_node_types, &mut functions);
    functions
}

fn __find_functions(
    cursor: &mut TreeCursor,
    source_code: &str,
    function_node_types: &[&str],
    functions: &mut Vec<FunctionMetrics>,
) {
    let node = cursor.node();
    
    if function_node_types.contains(&node.kind()) {
        let metrics = __analyze_function_node(node, source_code);
        functions.push(metrics);
    }
    
    if cursor.goto_first_child() {
        loop {
            __find_functions(cursor, source_code, function_node_types, functions);
            if !cursor.goto_next_sibling() {
                break;
            }
        }
        cursor.goto_parent();
    }
}

fn __analyze_function_node(node: Node, _source_code: &str) -> FunctionMetrics {
    let start_line = node.start_position().row + 1; // Convert to 1-indexed
    let end_line = node.end_position().row + 1;
    let length = end_line - start_line + 1;
    
    let max_nesting_depth = __calculate_max_nesting_depth(node);
    
    FunctionMetrics {
        start_line,
        end_line,
        length,
        max_nesting_depth,
    }
}

fn __calculate_max_nesting_depth(node: Node) -> usize {
    let mut max_depth = 0;
    let mut current_depth = 0;
    
    __traverse_for_nesting(&node, &mut current_depth, &mut max_depth);
    max_depth
}

fn __traverse_for_nesting(node: &Node, current_depth: &mut usize, max_depth: &mut usize) {
    // Increment depth for nesting constructs
    let increases_depth = matches!(
        node.kind(),
        "if_statement" | "while_statement" | "for_statement" | "loop_statement" 
        | "match_expression" | "try_statement" | "with_statement"
        | "if_expression" | "while_expression" | "for_expression"
        | "block" | "compound_statement"
    );
    
    if increases_depth {
        *current_depth += 1;
        *max_depth = (*max_depth).max(*current_depth);
    }
    
    // Recursively check children
    let mut cursor = node.walk();
    if cursor.goto_first_child() {
        loop {
            __traverse_for_nesting(&cursor.node(), current_depth, max_depth);
            if !cursor.goto_next_sibling() {
                break;
            }
        }
    }
    
    if increases_depth {
        *current_depth -= 1;
    }
} 