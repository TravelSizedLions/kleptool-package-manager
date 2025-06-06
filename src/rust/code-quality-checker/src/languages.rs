use tree_sitter::Language;

pub fn get_language_for_extension(extension: &str) -> Option<Language> {
  match extension {
    "ts" | "tsx" => Some(tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into()),
    "js" | "jsx" => Some(tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into()), // Close enough for now
    "rs" => Some(tree_sitter_rust::LANGUAGE.into()),
    "py" => Some(tree_sitter_python::LANGUAGE.into()),
    "sh" | "bash" => Some(tree_sitter_bash::LANGUAGE.into()),
    _ => None,
  }
}

pub fn get_function_node_types(extension: &str) -> Vec<&'static str> {
  match extension {
    "ts" | "tsx" | "js" | "jsx" => vec![
      "function_declaration",
      "method_definition",
      "arrow_function",
      "function_expression",
    ],
    "rs" => vec!["function_item", "closure_expression"],
    "py" => vec!["function_definition", "lambda"],
    "sh" | "bash" => vec!["function_definition"],
    _ => vec![],
  }
}
