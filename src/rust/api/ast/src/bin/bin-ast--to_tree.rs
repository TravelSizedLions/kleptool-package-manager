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

#[allow(clippy::unnecessary_wraps)]
fn parse_to_ast_tree(input: ParseInput) -> Result<AstTree, Box<dyn std::error::Error>> {
  let include_comments = input.include_comments.unwrap_or(false);

  debug_log(&format!(
    "Parsing {} code ({} chars) | Include comments: {}",
    input.language,
    input.source_code.len(),
    include_comments
  ));

  // TODO: Actual parsing logic here - when implemented, use include_comments
  // to determine whether to include comment nodes in the AST
  // For now, create a dummy AST that acknowledges the include_comments setting
  let mut children = vec![AstNode {
    node_type: "Statement".to_string(),
    value: Some("console.log('hello')".to_string()),
    location: Location {
      line: 1,
      column: 1,
      byte_offset: 0,
    },
    children: vec![],
  }];

  // If include_comments is true, add a dummy comment node
  if include_comments {
    children.push(AstNode {
      node_type: "Comment".to_string(),
      value: Some("// This is a comment".to_string()),
      location: Location {
        line: 2,
        column: 1,
        byte_offset: 20,
      },
      children: vec![],
    });
  }

  let total_nodes = children.len() + 1; // +1 for root
  let dummy_tree = AstTree {
    root: AstNode {
      node_type: "Program".to_string(),
      value: None,
      location: Location {
        line: 1,
        column: 1,
        byte_offset: 0,
      },
      children,
    },
    metadata: TreeMetadata {
      language: input.language,
      total_nodes,
      parse_time_ms: 1.23,
    },
  };

  debug_log(&format!(
    "Successfully parsed into {} nodes{}",
    dummy_tree.metadata.total_nodes,
    if include_comments {
      " (including comments)"
    } else {
      ""
    }
  ));
  Ok(dummy_tree)
}

// Use the macro for required input
ipc_main_required_input!(parse_to_ast_tree);
