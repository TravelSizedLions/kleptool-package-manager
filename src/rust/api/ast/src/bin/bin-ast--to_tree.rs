#![allow(missing_docs)]

use gud_common::{debug_log, ipc_main_required_input};
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
struct ParseInput {
  source_code: String,
  language: String,
  include_comments: Option<bool>,
}

#[derive(Serialize)]
struct AstTree {
  root: AstNode,
  metadata: TreeMetadata,
}

#[derive(Serialize)]
struct AstNode {
  node_type: String,
  value: Option<String>,
  children: Vec<AstNode>,
  location: Location,
}

#[derive(Serialize)]
struct Location {
  line: usize,
  column: usize,
  byte_offset: usize,
}

#[derive(Serialize)]
struct TreeMetadata {
  language: String,
  total_nodes: usize,
  parse_time_ms: f64,
}

fn parse_to_ast_tree(input: ParseInput) -> Result<AstTree, Box<dyn std::error::Error>> {
  debug_log(&format!(
    "Parsing {} code ({} chars)",
    input.language,
    input.source_code.len()
  ));

  // TODO: Actual parsing logic here
  // For now, create a dummy AST
  let dummy_tree = AstTree {
    root: AstNode {
      node_type: "Program".to_string(),
      value: None,
      location: Location {
        line: 1,
        column: 1,
        byte_offset: 0,
      },
      children: vec![AstNode {
        node_type: "Statement".to_string(),
        value: Some("console.log('hello')".to_string()),
        location: Location {
          line: 1,
          column: 1,
          byte_offset: 0,
        },
        children: vec![],
      }],
    },
    metadata: TreeMetadata {
      language: input.language,
      total_nodes: 2,
      parse_time_ms: 1.23,
    },
  };

  debug_log(&format!(
    "Successfully parsed into {} nodes",
    dummy_tree.metadata.total_nodes
  ));
  Ok(dummy_tree)
}

// Use the macro for required input
ipc_main_required_input!(parse_to_ast_tree);
