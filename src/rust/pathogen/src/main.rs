use anyhow::{Context, Result};
use clap::{Arg, ArgMatches, Command};
use std::path::PathBuf;
use std::time::Instant;

mod ast_parser;
mod cache;
mod file_safety;
mod mutation_engine;
mod mutation_runner;
mod types;

use ast_parser::TypeScriptParser;
use file_safety::SafeFileManager;
use mutation_engine::MutationEngine;
use mutation_runner::MutationRunner;
use types::{FileStats, KillType, MutationConfig, MutationStats};

#[tokio::main]
async fn main() -> Result<()> {
  let matches = build_cli_interface();
  let config = MutationConfig::from_args(&matches)?;

  let start_time = Instant::now();

  // Create isolated temp workspace
  let temp_workspace = create_temp_workspace(&config)?;
  println!("🏗️  Created isolated workspace: {}", temp_workspace.display());
  
  // Update config to use temp workspace
  let mut temp_config = config.clone();
  temp_config.source_dir = temp_workspace.clone();
  
  // Print banner with the actual workspace being used
  print_startup_banner(&temp_config);
  
  let mut components = initialize_components(&temp_config)?;
  let target_files = discover_and_validate_files(&temp_config)?;

  if !temp_config.dry_run {
    run_baseline_validation(&components.runner).await?;
  }

  let mutations = generate_mutations(&mut components, &target_files, &temp_config.source_dir, temp_config.verbose)?;

  if temp_config.dry_run {
    handle_dry_run(&mutations, temp_config.verbose);
    return Ok(());
  }

  let results = run_mutation_tests(&components.runner, mutations, temp_config.verbose).await?;
  let duration = start_time.elapsed();

  generate_and_save_report(&results, &target_files, duration, &temp_config)?;

  Ok(())
}

/// Build the command-line interface
fn build_cli_interface() -> ArgMatches {
  Command::new("klep-mutation-v2")
    .version("0.1.0")
    .about("Safe, fast, AST-based mutation testing for TypeScript")
    .arg(
      Arg::new("source")
        .short('s')
        .long("source")
        .value_name("DIR")
        .help("Source directory to test")
        .default_value("src/cli"),
    )
    .arg(
      Arg::new("parallel")
        .short('p')
        .long("parallel")
        .value_name("N")
        .help("Number of parallel test runners (auto-detects logical cores if not specified)")
        .required(false),
    )
    .arg(
      Arg::new("output")
        .short('o')
        .long("output")
        .value_name("FILE")
        .help("Output results to JSON file")
        .required(false),
    )
    .arg(
      Arg::new("verbose")
        .short('v')
        .long("verbose")
        .help("Verbose output")
        .action(clap::ArgAction::SetTrue),
    )
    .arg(
      Arg::new("dry-run")
        .long("dry-run")
        .help("Generate mutations but don't run tests (safety check)")
        .action(clap::ArgAction::SetTrue),
    )
    .arg(
      Arg::new("no-cache")
        .long("no-cache")
        .help("Disable caching to isolate race condition issues")
        .action(clap::ArgAction::SetTrue),
    )
    .get_matches()
}

/// Print the startup banner with configuration info
fn print_startup_banner(config: &MutationConfig) {
  // Auto-detect thread info for display
  let detected_cores = std::thread::available_parallelism()
    .map(|n| n.get())
    .unwrap_or(0);
  
  println!("{}", "=".repeat(80));
  println!("                             Pathogen v{}", env!("CARGO_PKG_VERSION"));
  println!("{}", "=".repeat(80));
  println!("📂 Source directory: {}", config.source_dir.display());
  
  if detected_cores > 0 && config.parallel_count == detected_cores {
    println!("🧵 Auto-detected {} logical cores, using {} parallel runners", detected_cores, config.parallel_count);
  } else {
    println!("🔧 Parallel runners: {}", config.parallel_count);
  }
  
  if config.dry_run {
    println!("🔍 DRY RUN MODE - No tests will be executed");
  }
  
  if config.no_cache {
    println!("🚫 Cache disabled - All tests will run fresh");
  }
}

/// Components needed for mutation testing
struct MutationComponents {
  parser: TypeScriptParser,
  engine: MutationEngine,
  runner: MutationRunner,
}

/// Initialize all components with safety-first design
fn initialize_components(config: &MutationConfig) -> Result<MutationComponents> {
  let parser = TypeScriptParser::new()?;
  let file_manager = SafeFileManager::new()?;
  let engine = MutationEngine::new()?;
  let runner = MutationRunner::new(config.parallel_count, file_manager, config.no_cache)?;

  Ok(MutationComponents {
    parser,
    engine,
    runner,
  })
}

/// Discover and validate target files
fn discover_and_validate_files(config: &MutationConfig) -> Result<Vec<PathBuf>> {
  println!("\n🔍 Discovering TypeScript files...");
  let target_files = discover_target_files(&config.source_dir)?;
  println!("🎯 Found {} files to analyze", target_files.len());

  if config.verbose {
    for file in &target_files {
      println!("   - {}", file.display());
    }
  }

  Ok(target_files)
}

/// Run baseline test validation
async fn run_baseline_validation(runner: &MutationRunner) -> Result<()> {
  if !runner.run_baseline_tests().await? {
    anyhow::bail!("❌ Baseline tests are failing! Fix tests before running mutation testing.");
  }
  Ok(())
}

/// Generate mutations from universalmutator files
fn generate_mutations(
  _components: &mut MutationComponents,
  _target_files: &[PathBuf],
  source_dir: &PathBuf,
  verbose: bool,
) -> Result<Vec<types::Mutation>> {
  println!("\n🧬 Loading universalmutator mutations...");
  let mutations = load_universalmutator_mutations(source_dir, verbose)?;
  println!("🎭 Loaded {} total mutations", mutations.len());
  Ok(mutations)
}

/// Handle dry run mode
fn handle_dry_run(mutations: &[types::Mutation], verbose: bool) {
  println!(
    "\n🔍 DRY RUN COMPLETE - Generated {} mutations safely",
    mutations.len()
  );
  if verbose {
    for (i, mutation) in mutations.iter().take(5).enumerate() {
      println!(
        "   Sample #{}: {} -> {}",
        i + 1,
        mutation.original,
        mutation.mutated
      );
    }
  }
}

/// Run mutation tests
async fn run_mutation_tests(
  runner: &MutationRunner,
  mutations: Vec<types::Mutation>,
  verbose: bool,
) -> Result<Vec<types::MutationResult>> {
  runner.run_mutations_safely(mutations, verbose).await
}

/// Create an isolated temp workspace by copying source files
fn create_temp_workspace(config: &MutationConfig) -> Result<PathBuf> {
  use std::fs;
  use tempfile::tempdir;
  
  // Create a temporary directory
  let temp_dir = tempdir()?;
  let temp_workspace = temp_dir.path().join("pathogen-workspace");
  
  // Copy source directory to temp workspace
  copy_directory_recursively(&config.source_dir, &temp_workspace)?;
  
  // Keep the temp directory alive by forgetting the tempdir handle
  // This prevents automatic cleanup - we'll clean up manually later
  std::mem::forget(temp_dir);
  
  Ok(temp_workspace)
}

/// Recursively copy a directory and all its contents
fn copy_directory_recursively(src: &PathBuf, dst: &PathBuf) -> Result<()> {
  use std::fs;
  use walkdir::WalkDir;
  
  // Create destination directory
  fs::create_dir_all(dst)?;
  
  // Copy all files and subdirectories
  for entry in WalkDir::new(src).into_iter().filter_map(|e| e.ok()) {
    let src_path = entry.path();
    let relative_path = src_path.strip_prefix(src)?;
    let dst_path = dst.join(relative_path);
    
    if src_path.is_dir() {
      fs::create_dir_all(&dst_path)?;
    } else {
      if let Some(parent) = dst_path.parent() {
        fs::create_dir_all(parent)?;
      }
      fs::copy(src_path, &dst_path)?;
    }
  }
  
  Ok(())
}

/// Generate and save the final report
fn generate_and_save_report(
  results: &[types::MutationResult],
  target_files: &[PathBuf],
  duration: std::time::Duration,
  config: &MutationConfig,
) -> Result<()> {
  let stats = generate_report(results, target_files, duration);

  if let Some(output_path) = &config.output_file {
    save_results_to_file(results, &stats, output_path)?;
    println!("💾 Results saved to: {}", output_path.display());
  }

  Ok(())
}

fn discover_target_files(source_dir: &PathBuf) -> Result<Vec<PathBuf>> {
  use walkdir::WalkDir;

  let exclude_patterns = [
    ".spec.ts",
    ".test.ts",
    "testing/moxxy/",
    "testing/utils/",
    "testing/setup/",
  ];

  let files: Vec<PathBuf> = WalkDir::new(source_dir)
    .into_iter()
    .filter_map(|entry| entry.ok())
    .filter(|entry| {
      let path = entry.path();
      path.extension().is_some_and(|ext| ext == "ts")
        && !exclude_patterns
          .iter()
          .any(|pattern| path.to_string_lossy().contains(pattern))
    })
    .map(|entry| entry.path().to_path_buf())
    .collect();

  Ok(files)
}

/// Load mutations from universalmutator-generated files
fn load_universalmutator_mutations(source_dir: &PathBuf, verbose: bool) -> Result<Vec<types::Mutation>> {
  use std::fs;
  
  let mutations_dir = PathBuf::from(".mutations/typescript");
  if !mutations_dir.exists() {
    anyhow::bail!("❌ No mutations directory found at .mutations/typescript. Run pathogen:plan first!");
  }

  let mut mutations = Vec::new();
  let mut mutation_id_counter = 1;

  // Read all mutation files
  for entry in fs::read_dir(&mutations_dir)? {
    let entry = entry?;
    let path = entry.path();
    
    if !path.extension().map_or(false, |ext| ext == "ts") {
      continue;
    }

    let filename = path.file_name()
      .and_then(|f| f.to_str())
      .unwrap_or("unknown");

    if verbose {
      println!("   🔍 Loading: {}", filename);
    }

    // Parse the mutation file info from filename
    // Format: originalfile.mutant.NUMBER.ts
    if let Some(mutation) = parse_universalmutator_file(&path, source_dir, mutation_id_counter)? {
      mutations.push(mutation);
      mutation_id_counter += 1;
    }
  }

  Ok(mutations)
}

/// Parse a single universalmutator file into a Mutation struct
fn parse_universalmutator_file(mutant_path: &PathBuf, source_dir: &PathBuf, id_counter: usize) -> Result<Option<types::Mutation>> {
  use std::fs;
  
  // Extract original file and mutation number from filename
  let filename = mutant_path.file_stem()
    .and_then(|f| f.to_str())
    .ok_or_else(|| anyhow::anyhow!("Invalid filename: {}", mutant_path.display()))?;
  
  // Parse filename: originalfile.mutant.NUMBER
  let parts: Vec<&str> = filename.split('.').collect();
  if parts.len() < 3 || parts[parts.len() - 2] != "mutant" {
    return Ok(None); // Skip non-mutant files
  }
  
  let original_filename = parts[0]; // Just the base filename
  
  // Try to find the original file in the source tree
  let original_file = find_original_file(original_filename, source_dir)?;
  
  // Read both original and mutant content
  let original_content = fs::read_to_string(&original_file)
    .with_context(|| format!("Failed to read original file: {}", original_file.display()))?;
  let mutant_content = fs::read_to_string(mutant_path)
    .with_context(|| format!("Failed to read mutant file: {}", mutant_path.display()))?;
  
  // Find the first difference to identify the mutation for reporting
  let (line, original_text, mutated_text) = find_mutation_difference(&original_content, &mutant_content)?;
  
  let mutation = types::Mutation {
    id: format!("unimut_{}", id_counter),
    file: original_file,
    line,
    column: 0, // universalmutator doesn't provide column info
    span_start: 0, // Will be ignored - we use full content replacement
    span_end: 0, // Will be ignored - we use full content replacement  
    original: original_text.clone(), // Store just the diff for reporting
    mutated: mutated_text.clone(), // Store just the diff for reporting
    mutation_type: types::MutationType::ArithmeticOperator, // Default for now
    description: format!("universalmutator mutation: {} → {}", original_text, mutated_text),
  };
  
  Ok(Some(mutation))
}

/// Find the original source file for a given base filename
fn find_original_file(base_filename: &str, source_dir: &PathBuf) -> Result<PathBuf> {
  use std::fs;
  
  let target_filename = format!("{}.ts", base_filename);
  
  // Search recursively in the provided source directory
  fn search_in_dir(dir: &PathBuf, target: &str) -> Option<PathBuf> {
    if let Ok(entries) = fs::read_dir(dir) {
      for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() && path.file_name().map_or(false, |name| name == target) {
          return Some(path);
        } else if path.is_dir() {
          if let Some(found) = search_in_dir(&path, target) {
            return Some(found);
          }
        }
      }
    }
    None
  }
  
  search_in_dir(source_dir, &target_filename)
    .ok_or_else(|| anyhow::anyhow!("Could not find original file for: {} in {}", base_filename, source_dir.display()))
}

/// Find the difference between original and mutant content
fn find_mutation_difference(original: &str, mutant: &str) -> Result<(usize, String, String)> {
  let original_lines: Vec<&str> = original.lines().collect();
  let mutant_lines: Vec<&str> = mutant.lines().collect();
  
  for (line_num, (orig_line, mut_line)) in original_lines.iter().zip(mutant_lines.iter()).enumerate() {
    if orig_line != mut_line {
      // Found the difference - extract the changed part
      let orig_trimmed = orig_line.trim();
      let mut_trimmed = mut_line.trim();
      
      if orig_trimmed != mut_trimmed {
        return Ok((line_num + 1, orig_trimmed.to_string(), mut_trimmed.to_string()));
      }
    }
  }
  
  // Fallback if no difference found
  Ok((1, "unknown".to_string(), "unknown".to_string()))
}

fn generate_mutations_from_ast(
  parser: &mut TypeScriptParser,
  engine: &MutationEngine,
  files: &[PathBuf],
  verbose: bool,
) -> Result<Vec<types::Mutation>> {
  // NOTE: Cannot use rayon here because parser is not Send + Sync
  // This is a limitation of tree-sitter parsers
  let mut mutations = Vec::new();

  for file_path in files {
    if verbose {
      println!("   🔍 Parsing: {}", file_path.display());
    }

    match parser.parse_file_with_ast(file_path) {
      Ok(parsed_file) => {
        let file_mutations = engine.generate_ast_mutations(&parsed_file);
        if verbose {
          println!("      Generated {} mutations", file_mutations.len());
        }
        mutations.extend(file_mutations);
      }
      Err(e) => {
        eprintln!("⚠️  Failed to parse {}: {}", file_path.display(), e);
      }
    }
  }

  Ok(mutations)
}

fn generate_report(
  results: &[types::MutationResult],
  target_files: &[PathBuf],
  duration: std::time::Duration,
) -> MutationStats {
  let summary_stats = calculate_summary_stats(results, duration);
  let per_file_stats = calculate_per_file_stats(results);

  print_summary_report(&summary_stats, duration);
  print_per_file_breakdown(&per_file_stats);
  print_final_assessment(&summary_stats);

  MutationStats {
    total_mutations: summary_stats.total,
    behavioral_kills: summary_stats.behavioral_kills,
    compile_errors: summary_stats.compile_errors,
    survived: summary_stats.survived,
    duration: duration.as_secs_f64(),
    files_tested: target_files.len(),
    per_file_stats,
  }
}

/// Summary statistics for the mutation run
struct SummaryStats {
  total: usize,
  behavioral_kills: usize,
  compile_errors: usize,
  survived: usize,
  behavioral_rate: f64,
  kill_rate: f64,
}

/// Calculate overall summary statistics
fn calculate_summary_stats(
  results: &[types::MutationResult],
  _duration: std::time::Duration,
) -> SummaryStats {
  let total = results.len();
  let behavioral_kills = results
    .iter()
    .filter(|r| matches!(r.kill_type, KillType::BehavioralKill))
    .count();
  let compile_errors = results
    .iter()
    .filter(|r| matches!(r.kill_type, KillType::CompileError))
    .count();
  let survived = results
    .iter()
    .filter(|r| matches!(r.kill_type, KillType::Survived))
    .count();

  let behavioral_rate = if total > 0 {
    (behavioral_kills as f64 / total as f64) * 100.0
  } else {
    0.0
  };
  let kill_rate = if total > 0 {
    ((behavioral_kills + compile_errors) as f64 / total as f64) * 100.0
  } else {
    0.0
  };

  SummaryStats {
    total,
    behavioral_kills,
    compile_errors,
    survived,
    behavioral_rate,
    kill_rate,
  }
}

/// Calculate per-file mutation statistics
fn calculate_per_file_stats(results: &[types::MutationResult]) -> Vec<FileStats> {
  use std::collections::HashMap;

  let mut file_results: HashMap<String, Vec<&types::MutationResult>> = HashMap::new();
  for result in results {
    let file_path = result.mutation.file.to_string_lossy().to_string();
    file_results.entry(file_path).or_default().push(result);
  }

  let mut per_file_stats: Vec<FileStats> = file_results
    .into_iter()
    .map(|(file_path, file_mutations)| build_file_stats(file_path, file_mutations))
    .collect();

  // Sort by kill rate (lowest first - files needing most attention)
  per_file_stats.sort_by(|a, b| {
    a.kill_rate
      .partial_cmp(&b.kill_rate)
      .unwrap_or(std::cmp::Ordering::Equal)
  });

  per_file_stats
}

/// Build statistics for a single file
fn build_file_stats(file_path: String, file_mutations: Vec<&types::MutationResult>) -> FileStats {
  let total_mutations = file_mutations.len();
  let behavioral_kills = file_mutations
    .iter()
    .filter(|r| matches!(r.kill_type, KillType::BehavioralKill))
    .count();
  let compile_errors = file_mutations
    .iter()
    .filter(|r| matches!(r.kill_type, KillType::CompileError))
    .count();
  let survived = file_mutations
    .iter()
    .filter(|r| matches!(r.kill_type, KillType::Survived))
    .count();
  let kill_rate = if total_mutations > 0 {
    ((behavioral_kills + compile_errors) as f64 / total_mutations as f64) * 100.0
  } else {
    0.0
  };

  let survived_mutations: Vec<types::Mutation> = file_mutations
    .iter()
    .filter(|r| matches!(r.kill_type, KillType::Survived))
    .map(|r| r.mutation.clone())
    .collect();

  FileStats {
    file_path,
    total_mutations,
    behavioral_kills,
    compile_errors,
    survived,
    kill_rate,
    survived_mutations,
  }
}

/// Print the summary report header
fn print_summary_report(stats: &SummaryStats, duration: std::time::Duration) {
  println!();
  println!("{}", "=".repeat(80));
  println!("                         Project Resiliency Results");
  println!("{}", "=".repeat(80));
  println!("📊 Total mutations: {}", stats.total);
  println!(
    "🧬 Behavioral kills: {}/{} ({:.1}%)",
    stats.behavioral_kills, stats.total, stats.behavioral_rate
  );
  println!(
    "⚠️  Compile errors: {}/{} ({:.1}%)",
    stats.compile_errors,
    stats.total,
    (stats.compile_errors as f64 / stats.total as f64) * 100.0
  );
  println!(
    "😱 Survived: {}/{} ({:.1}%)",
    stats.survived,
    stats.total,
    (stats.survived as f64 / stats.total as f64) * 100.0
  );
  println!(
    "💀 Total killed: {}/{} ({:.1}%)",
    stats.behavioral_kills + stats.compile_errors,
    stats.total,
    stats.kill_rate
  );
  println!("⏱️  Total time: {:.2}s", duration.as_secs_f64());
  println!(
    "🚀 Mutations per second: {:.1}",
    stats.total as f64 / duration.as_secs_f64()
  );
}

/// Print per-file breakdown in table format
fn print_per_file_breakdown(per_file_stats: &[FileStats]) {
  println!();
  println!("📁 File Coverage Breakdown");
  println!("{}", "-".repeat(80));
  println!("{:<41} {:>8} {:>8} {:>9} {:>9}", "File", "Total", "Killed", "Survived", "Coverage");
  println!("{}", "-".repeat(80));
  
  for file_stat in per_file_stats {
    print_file_table_row(file_stat);
  }
  
  println!("{}", "-".repeat(80));
  
  // Show survivor details for files that have them
  let files_with_survivors: Vec<_> = per_file_stats.iter()
    .filter(|fs| !fs.survived_mutations.is_empty())
    .collect();
    
  if !files_with_survivors.is_empty() {
    println!();
    println!("Mutation Survivors:");
    println!("{}", "-".repeat(80));
    for file_stat in files_with_survivors {
      print_survivors_info(file_stat);
    }
    println!(); // Extra newline after survivors
  }
}

/// Print a single file's stats as a table row
fn print_file_table_row(file_stat: &FileStats) {
  let short_path = file_stat.file_path.replace("src/cli/", "");
  let status_icon = get_status_icon(file_stat.kill_rate);
  
  let display_path = if short_path.len() > 34 { 
    short_path[..31].to_owned() + "..." 
  } else { 
    short_path 
  };
  
  println!(
    "{} {:<38} {:>8} {:>8} {:>9} {:>8.1}%",
    status_icon,
    display_path,
    file_stat.total_mutations,
    file_stat.behavioral_kills + file_stat.compile_errors,
    file_stat.survived,
    file_stat.kill_rate
  );
}

/// Get status icon based on kill rate
fn get_status_icon(kill_rate: f64) -> &'static str {
  if kill_rate >= 95.0 {
    "🟢"
  } else if kill_rate >= 80.0 {
    "🟡"
  } else {
    "🔴"
  }
}

/// Print information about survived mutations for a file
fn print_survivors_info(file_stat: &FileStats) {
  let short_path = file_stat.file_path.replace("src/cli/", "");
  println!();
  println!("📄 {} ({} survivors):", short_path, file_stat.survived_mutations.len());
  
  for (i, survivor) in file_stat.survived_mutations.iter().enumerate() {
    if i >= 5 {  // Limit to first 5 for readability
      println!("     ... and {} more (see JSON report for full list)", 
               file_stat.survived_mutations.len() - 5);
      break;
    }
    println!(
      "     • Line {}: {} → {}",
      survivor.line, survivor.original, survivor.mutated
    );
  }
}

/// Print final assessment and warnings
fn print_final_assessment(stats: &SummaryStats) {
  let grade = get_coverage_grade(stats.behavioral_rate);

  if stats.compile_errors > stats.behavioral_kills {
    println!("⚠️  WARNING: More compile errors than behavioral kills!");
    println!("🔧 Consider refining mutation operators");
  }
  println!("{}", grade);
}

/// Get coverage grade based on behavioral rate
fn get_coverage_grade(behavioral_rate: f64) -> &'static str {
  if behavioral_rate >= 80.0 {
    "🟢 EXCELLENT behavioral coverage!"
  } else if behavioral_rate >= 60.0 {
    "🟡 GOOD behavioral coverage"
  } else {
    "🔴 Behavioral coverage needs improvement"
  }
}

fn save_results_to_file(
  results: &[types::MutationResult],
  stats: &MutationStats,
  output_path: &PathBuf,
) -> Result<()> {
  use std::fs;

  let output = serde_json::json!({
      "stats": stats,
      "results": results,
      "generated_at": chrono::Utc::now().to_rfc3339(),
      "version": env!("CARGO_PKG_VERSION")
  });

  fs::write(output_path, serde_json::to_string_pretty(&output)?)?;
  Ok(())
}
