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
  pub length: usize,
  pub max_nesting_depth: usize,
  pub cyclomatic_complexity: usize,
}

pub fn analyze_tree(
  tree: &Tree,
  source_code: &str,
  function_node_types: &[&str],
) -> Vec<FunctionMetrics> {
  let mut functions = Vec::new();
  let mut cursor = tree.walk();

  __find_functions(
    &mut cursor,
    source_code,
    function_node_types,
    &mut functions,
  );
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

  __traverse(cursor, source_code, function_node_types, functions);
}

fn __traverse(
  cursor: &mut TreeCursor,
  source_code: &str,
  function_node_types: &[&str],
  functions: &mut Vec<FunctionMetrics>,
) {
  if !cursor.goto_first_child() {
    return;
  }

  loop {
    __find_functions(cursor, source_code, function_node_types, functions);
    if !cursor.goto_next_sibling() {
      break;
    }
  }
  cursor.goto_parent();
}

fn __analyze_function_node(node: Node, _source_code: &str) -> FunctionMetrics {
  let start_line = node.start_position().row + 1; // Convert to 1-indexed
  let end_line = node.end_position().row + 1;
  let length = end_line - start_line + 1;

  let max_nesting_depth = __calculate_max_nesting_depth(node);
  let cyclomatic_complexity = __calculate_cyclomatic_complexity(node);

  FunctionMetrics {
    start_line,
    length,
    max_nesting_depth,
    cyclomatic_complexity,
  }
}

fn __calculate_max_nesting_depth(node: Node) -> usize {
  let mut max_depth = 0;
  let mut current_depth = 0;

  __traverse_for_nesting(&node, &mut current_depth, &mut max_depth);
  max_depth
}

fn __traverse_for_nesting(node: &Node, current_depth: &mut usize, max_depth: &mut usize) {
  let increases_depth = __node_increases_nesting_depth(node);

  if increases_depth {
    *current_depth += 1;
    *max_depth = (*max_depth).max(*current_depth);
  }

  __traverse_children_for_nesting(node, current_depth, max_depth);

  if increases_depth {
    *current_depth -= 1;
  }
}

fn __node_increases_nesting_depth(node: &Node) -> bool {
  matches!(
    node.kind(),
    // Conditional statements
    "if_statement" | "if_expression"

      // Loops  
      | "while_statement" | "while_expression"
      | "for_statement" | "for_expression"
      | "loop_statement"

      // Pattern matching and exception handling
      | "match_expression"
      | "try_statement"
      | "with_statement" // Note: removed "block" and "compound_statement" to avoid double-counting
                         // The control flow statements above already imply their blocks
  )
}

fn __traverse_children_for_nesting(node: &Node, current_depth: &mut usize, max_depth: &mut usize) {
  let mut cursor = node.walk();
  if !cursor.goto_first_child() {
    return;
  }

  loop {
    __traverse_for_nesting(&cursor.node(), current_depth, max_depth);
    if !cursor.goto_next_sibling() {
      break;
    }
  }
}

fn __calculate_cyclomatic_complexity(node: Node) -> usize {
  let mut complexity = 1; // Base complexity
  __traverse_for_complexity(&node, &mut complexity);
  complexity
}

fn __traverse_for_complexity(node: &Node, complexity: &mut usize) {
  let is_decision_point = __node_is_decision_point(node);

  if is_decision_point {
    __handle_decision_point(node, complexity);
  }

  __traverse_children_for_complexity(node, complexity);
}

fn __node_is_decision_point(node: &Node) -> bool {
  matches!(
    node.kind(),
    // Conditional statements
    "if_statement" | "if_expression" | "conditional_expression" | "ternary_expression"

        // Loops
        | "while_statement" | "while_expression" | "for_statement" | "for_expression" 
        | "loop_statement" | "do_statement"

        // Pattern matching/switch
        | "match_expression" | "match_arm" | "switch_statement" | "case_clause"

        // Exception handling
        | "try_statement" | "catch_clause" | "except_clause"

        // Logical operators (short-circuit evaluation creates new paths)
        | "binary_expression" | "logical_and" | "logical_or"

        // Function calls that can branch (sometimes)
        | "yield_expression" | "await_expression"
  )
}

fn __handle_decision_point(node: &Node, complexity: &mut usize) {
  if node.kind() == "binary_expression" {
    __handle_binary_expression_complexity(node, complexity);
    return;
  }

  *complexity += 1;
}

fn __handle_binary_expression_complexity(node: &Node, complexity: &mut usize) {
  let mut cursor = node.walk();
  if !cursor.goto_first_child() {
    return;
  }

  loop {
    let child = cursor.node();
    if matches!(child.kind(), "&&" | "||" | "and" | "or") {
      *complexity += 1;
      break;
    }
    if !cursor.goto_next_sibling() {
      break;
    }
  }
}

fn __traverse_children_for_complexity(node: &Node, complexity: &mut usize) {
  let mut cursor = node.walk();
  if !cursor.goto_first_child() {
    return;
  }

  loop {
    __traverse_for_complexity(&cursor.node(), complexity);
    if !cursor.goto_next_sibling() {
      break;
    }
  }
}
