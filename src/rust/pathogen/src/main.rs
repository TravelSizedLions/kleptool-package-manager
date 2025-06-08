use anyhow::{Context, Result};
use clap::{Arg, ArgMatches, Command};
use std::path::{Path, PathBuf};
use std::time::Instant;

pub mod cache;
pub mod types;
pub mod worker_pool;

use types::{FileStats, KillType, MutationConfig, MutationStats};
use worker_pool::WorkerPool;

#[tokio::main]
async fn main() -> Result<()> {
  let matches = build_cli_interface();
  let config = MutationConfig::from_args(&matches)?;

  let start_time = Instant::now();

  // Create isolated temp workspace
  let temp_workspace = create_temp_workspace(&config)?;
  if config.verbose {
    println!("Created isolated workspace: {}", temp_workspace.display());
  }

  // Calculate the relative path of the source directory within the project
  let project_root = std::env::current_dir()?;
  let source_canonical = config.source_dir.canonicalize()?;
  let project_canonical = project_root.canonicalize()?;
  let source_relative = source_canonical
    .strip_prefix(&project_canonical)
    .map_err(|_| anyhow::anyhow!("Source dir must be within project"))?;

  // Update config to use temp workspace
  let mut temp_config = config.clone();
  temp_config.source_dir = temp_workspace.join(source_relative);

  // Print banner with the actual workspace being used
  print_startup_banner(&temp_config);

  let target_files = discover_and_validate_files(&temp_config)?;

  let mutations = generate_mutations(&temp_config.source_dir, &temp_config, temp_config.verbose)?;

  if temp_config.dry_run {
    handle_dry_run(&mutations, temp_config.verbose);
    return Ok(());
  }

  let results = run_mutation_tests(
    &temp_workspace,
    mutations,
    temp_config.parallel_count,
    temp_config.verbose,
  )
  .await?;
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
  if config.verbose {
    // Auto-detect thread info for display
    let detected_cores = std::thread::available_parallelism()
      .map(|n| n.get())
      .unwrap_or(0);

    println!("{}", "=".repeat(80));
    println!(
      "                             Pathogen v{}",
      env!("CARGO_PKG_VERSION")
    );
    println!("{}", "=".repeat(80));
    println!("Source directory: {}", config.source_dir.display());

    if detected_cores > 0 && config.parallel_count == detected_cores {
      println!(
        "Auto-detected {} logical cores, using {} parallel runners",
        detected_cores, config.parallel_count
      );
    } else {
      println!("Parallel runners: {}", config.parallel_count);
    }

    if config.dry_run {
      println!("DRY RUN MODE - No tests will be executed");
    }

    if config.no_cache {
      println!("Cache disabled - All tests will run fresh");
    }
  } else {
    println!("Pathogen v{} - {} workers", env!("CARGO_PKG_VERSION"), config.parallel_count);
  }
}

/// Discover and validate target files
fn discover_and_validate_files(config: &MutationConfig) -> Result<Vec<PathBuf>> {
  let target_files = discover_target_files(config)?;
  
  if config.verbose {
    println!(
      "Discovering {} files...",
      match config.language {
        types::Language::TypeScript => "TypeScript",
        types::Language::Rust => "Rust",
      }
    );
    println!("Found {} files to analyze", target_files.len());
    for file in &target_files {
      println!("   - {}", file.display());
    }
  }

  Ok(target_files)
}

/// Generate mutations from universalmutator files
fn generate_mutations(
  source_dir: &PathBuf,
  config: &MutationConfig,
  verbose: bool,
) -> Result<Vec<types::Mutation>> {
  let mutations = load_universalmutator_mutations(source_dir, &config.language, verbose)?;
  
  if verbose {
    println!("Loading universalmutator mutations...");
    println!("Loaded {} total mutations", mutations.len());
  }
  
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
  workspace_dir: &Path,
  mutations: Vec<types::Mutation>,
  parallel_count: usize,
  verbose: bool,
) -> Result<Vec<types::MutationResult>> {
  println!(
    "\n🧪 Starting mutation testing with {} workers...",
    parallel_count
  );

  let worker_pool = WorkerPool::new(parallel_count, workspace_dir.to_path_buf()).await?;
  let results = worker_pool.run_mutations(mutations, verbose).await?;
  worker_pool.shutdown().await?;

  Ok(results)
}

/// Create an isolated temp workspace by copying necessary project files
fn create_temp_workspace(config: &MutationConfig) -> Result<PathBuf> {
  let temp_workspace = __setup_temp_directory()?;
  let (project_root, source_canonical, project_canonical) = __resolve_workspace_paths(config)?;

  __symlink_project_files(&project_root, &temp_workspace)?;
  __setup_source_directory_for_mutation(
    config,
    &temp_workspace,
    &source_canonical,
    &project_canonical,
  )?;

  Ok(temp_workspace)
}

fn __setup_temp_directory() -> Result<PathBuf> {
  use std::fs;
  use tempfile::tempdir;

  let temp_dir = tempdir()?;
  let temp_workspace = temp_dir.path().join("pathogen-workspace");
  fs::create_dir_all(&temp_workspace)?;

  // Keep the temp directory alive by forgetting the tempdir handle
  std::mem::forget(temp_dir);

  Ok(temp_workspace)
}

fn __resolve_workspace_paths(config: &MutationConfig) -> Result<(PathBuf, PathBuf, PathBuf)> {
  let project_root = std::env::current_dir()?;
  let source_canonical = config.source_dir.canonicalize()?;
  let project_canonical = project_root.canonicalize()?;
  Ok((project_root, source_canonical, project_canonical))
}

fn __symlink_project_files(project_root: &Path, temp_workspace: &Path) -> Result<()> {
  use std::fs;

  for entry in fs::read_dir(project_root)? {
    let entry = entry?;
    let src_path = entry.path();
    let file_name = src_path.file_name().unwrap();

    if __should_skip_file(&file_name.to_string_lossy()) {
      continue;
    }

    let dst_path = temp_workspace.join(file_name);
    __link_or_copy_file(&src_path, &dst_path)?;
  }

  Ok(())
}

fn __should_skip_file(name: &str) -> bool {
  name.starts_with('.')
    || name == "target"
    || name.starts_with("tmp")
    || name == "node_modules/.cache"
}

fn __link_or_copy_file(src_path: &Path, dst_path: &Path) -> Result<()> {
  use std::fs;

  if let Ok(src_canonical) = src_path.canonicalize() {
    // Try creating a symlink (cross-platform compatible)
    let symlink_result = __create_symlink(&src_canonical, dst_path);

    // Fall back to copying if symlink fails
    if symlink_result.is_err() {
      if src_canonical.is_dir() {
        copy_directory_recursively(&src_canonical, dst_path)?;
      } else {
        fs::copy(&src_canonical, dst_path)?;
      }
    }
  }

  Ok(())
}

#[cfg(unix)]
fn __create_symlink(src: &Path, dst: &Path) -> std::io::Result<()> {
  std::os::unix::fs::symlink(src, dst)
}

#[cfg(windows)]
fn __create_symlink(src: &Path, dst: &Path) -> std::io::Result<()> {
  if src.is_dir() {
    std::os::windows::fs::symlink_dir(src, dst)
  } else {
    std::os::windows::fs::symlink_file(src, dst)
  }
}

#[cfg(not(any(unix, windows)))]
fn __create_symlink(_src: &Path, _dst: &Path) -> std::io::Result<()> {
  Err(std::io::Error::new(
    std::io::ErrorKind::Unsupported,
    "Symlinks not supported on this platform",
  ))
}

fn __setup_source_directory_for_mutation(
  config: &MutationConfig,
  temp_workspace: &Path,
  source_canonical: &Path,
  project_canonical: &Path,
) -> Result<()> {
  let source_relative = __get_source_relative_path(source_canonical, project_canonical)?;
  let dst_source = temp_workspace.join(&source_relative);

  __validate_destination_path(&dst_source, temp_workspace)?;
  __recreate_source_structure(temp_workspace, &source_relative, project_canonical)?;
  __copy_source_files_for_mutation(config, &dst_source)?;

  Ok(())
}

fn __get_source_relative_path(
  source_canonical: &Path,
  project_canonical: &Path,
) -> Result<PathBuf> {
  source_canonical
    .strip_prefix(project_canonical)
    .map(|p| p.to_path_buf())
    .map_err(|_| {
      std::io::Error::new(
        std::io::ErrorKind::InvalidInput,
        "Source dir must be within project",
      )
      .into()
    })
}

fn __validate_destination_path(dst_path: &Path, temp_workspace: &Path) -> Result<()> {
  if !dst_path.starts_with(temp_workspace) {
    return Err(
      std::io::Error::new(
        std::io::ErrorKind::InvalidInput,
        "Safety check failed: destination path not in temp workspace",
      )
      .into(),
    );
  }
  Ok(())
}

fn __recreate_source_structure(
  temp_workspace: &Path,
  source_relative: &Path,
  project_canonical: &Path,
) -> Result<()> {
  use std::fs;

  let source_parts: Vec<_> = source_relative.components().collect();
  if source_parts.is_empty() {
    return Err(std::io::Error::new(std::io::ErrorKind::InvalidInput, "Empty source path").into());
  }

  let top_level_dir = source_parts[0].as_os_str();
  let src_symlink = temp_workspace.join(top_level_dir);

  __validate_destination_path(&src_symlink, temp_workspace)?;

  if src_symlink.exists() {
    fs::remove_dir_all(&src_symlink)?;
  }

  let original_top_level = project_canonical.join(top_level_dir);
  copy_directory_recursively(&original_top_level, &src_symlink)?;

  Ok(())
}

fn __copy_source_files_for_mutation(config: &MutationConfig, dst_source: &PathBuf) -> Result<()> {
  use std::fs;

  if dst_source.exists() {
    fs::remove_dir_all(dst_source)?;
  }

  if let Some(parent) = dst_source.parent() {
    fs::create_dir_all(parent)?;
  }

  copy_directory_recursively(&config.source_dir, dst_source)?;
  Ok(())
}

/// Recursively copy a directory and all its contents
fn copy_directory_recursively(src: &Path, dst: &Path) -> Result<()> {
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

fn discover_target_files(config: &MutationConfig) -> Result<Vec<PathBuf>> {
  use walkdir::WalkDir;

  let (target_extension, exclude_patterns) = match config.language {
    types::Language::TypeScript => (
      "ts",
      vec![
        ".spec.ts",
        ".test.ts",
        "testing/moxxy/",
        "testing/utils/",
        "testing/setup/",
      ],
    ),
    types::Language::Rust => (
      "rs",
      vec!["tests/", "target/", "examples/"], // Exclude test directories and build artifacts
    ),
  };

  let files: Vec<PathBuf> = WalkDir::new(&config.source_dir)
    .into_iter()
    .filter_map(|entry| entry.ok())
    .filter(|entry| {
      let path = entry.path();
      path.extension().is_some_and(|ext| ext == target_extension)
        && !exclude_patterns
          .iter()
          .any(|pattern| path.to_string_lossy().contains(pattern))
    })
    .map(|entry| entry.path().to_path_buf())
    .collect();

  Ok(files)
}

/// Load mutations from universalmutator-generated files
fn load_universalmutator_mutations(
  source_dir: &PathBuf,
  language: &types::Language,
  _verbose: bool,
) -> Result<Vec<types::Mutation>> {
  use std::fs;

  let (mutations_dir, file_extension) = match language {
    types::Language::TypeScript => (PathBuf::from(".mutations/typescript"), "ts"),
    types::Language::Rust => (PathBuf::from(".mutations/rust"), "rs"),
  };

  if !mutations_dir.exists() {
    anyhow::bail!(
      "❌ No mutations directory found at {}. Run pathogen:plan first!",
      mutations_dir.display()
    );
  }

  let mut mutations = Vec::new();
  let mut mutation_id_counter = 1;

  // Read all mutation files
  for entry in fs::read_dir(&mutations_dir)? {
    let entry = entry?;
    let path = entry.path();

    if path.extension().is_none_or(|ext| ext != file_extension) {
      continue;
    }

    // Removed verbose loading messages to reduce output noise

    // Parse the mutation file info from filename
    // Format: originalfile.mutant.NUMBER.ext
    if let Some(mutation) =
      parse_universalmutator_file(&path, source_dir, mutation_id_counter, language)?
    {
      mutations.push(mutation);
      mutation_id_counter += 1;
    }
  }

  Ok(mutations)
}

/// Parse a single universalmutator file into a Mutation struct
fn parse_universalmutator_file(
  mutant_path: &PathBuf,
  source_dir: &PathBuf,
  id_counter: usize,
  language: &types::Language,
) -> Result<Option<types::Mutation>> {
  use std::fs;

  // Extract original file and mutation number from filename
  let filename = mutant_path
    .file_stem()
    .and_then(|f| f.to_str())
    .ok_or_else(|| anyhow::anyhow!("Invalid filename: {}", mutant_path.display()))?;

  // Parse filename: originalfile.mutant.NUMBER
  let parts: Vec<&str> = filename.split('.').collect();
  if parts.len() < 3 || parts[parts.len() - 2] != "mutant" {
    return Ok(None); // Skip non-mutant files
  }

  let original_filename = parts[0]; // Just the base filename

  // Try to find the original file in the source tree
  let original_file = find_original_file(original_filename, source_dir, language)?;

  // Read both original and mutant content
  let original_content = fs::read_to_string(&original_file)
    .with_context(|| format!("Failed to read original file: {}", original_file.display()))?;
  let mutant_content = fs::read_to_string(mutant_path)
    .with_context(|| format!("Failed to read mutant file: {}", mutant_path.display()))?;

  // Find the first difference to identify the mutation for reporting
  let (line, original_text, mutated_text) =
    find_mutation_difference(&original_content, &mutant_content)?;

  let mutation = types::Mutation {
    id: format!("unimut_{}", id_counter),
    file: original_file,
    line,
    column: 0,                       // universalmutator doesn't provide column info
    span_start: 0,                   // Will be ignored - we use full content replacement
    span_end: 0,                     // Will be ignored - we use full content replacement
    original: original_text.clone(), // Store just the diff for reporting
    mutated: mutant_content,         // Store the FULL mutated file content
    mutation_type: types::MutationType::ArithmeticOperator, // Default for now
    description: format!(
      "universalmutator mutation: {} → {}",
      original_text, mutated_text
    ),
    language: language.clone(),
  };

  Ok(Some(mutation))
}

/// Find the original source file for a given base filename
fn find_original_file(
  base_filename: &str,
  source_dir: &PathBuf,
  language: &types::Language,
) -> Result<PathBuf> {
  let target_filename = format!("{}.{}", base_filename, language.extension());

  __recursive_file_search(source_dir, &target_filename).ok_or_else(|| {
    anyhow::anyhow!(
      "Could not find original file for: {} in {}",
      base_filename,
      source_dir.display()
    )
  })
}

fn __recursive_file_search(dir: &PathBuf, target: &str) -> Option<PathBuf> {
  use std::fs;

  let entries = fs::read_dir(dir).ok()?;

  for entry in entries.flatten() {
    let path = entry.path();

    if let Some(found) = __check_entry_for_target(&path, target) {
      return Some(found);
    }
  }

  None
}

fn __check_entry_for_target(path: &PathBuf, target: &str) -> Option<PathBuf> {
  if path.is_file() {
    return __check_if_target_file(path, target);
  }

  if path.is_dir() {
    return __recursive_file_search(path, target);
  }

  None
}

fn __check_if_target_file(path: &Path, target: &str) -> Option<PathBuf> {
  path
    .file_name()
    .filter(|name| *name == target)
    .map(|_| path.to_path_buf())
}

/// Find the difference between original and mutant content
fn find_mutation_difference(original: &str, mutant: &str) -> Result<(usize, String, String)> {
  let original_lines: Vec<&str> = original.lines().collect();
  let mutant_lines: Vec<&str> = mutant.lines().collect();

  for (line_num, (orig_line, mut_line)) in
    original_lines.iter().zip(mutant_lines.iter()).enumerate()
  {
    if orig_line != mut_line {
      // Found the difference - extract the changed part
      let orig_trimmed = orig_line.trim();
      let mut_trimmed = mut_line.trim();

      if orig_trimmed != mut_trimmed {
        return Ok((
          line_num + 1,
          orig_trimmed.to_string(),
          mut_trimmed.to_string(),
        ));
      }
    }
  }

  // Fallback if no difference found
  Ok((1, "unknown".to_string(), "unknown".to_string()))
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
  print_final_assessment(&summary_stats, results);

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

  // Calculate behavioral rate against viable mutations only (exclude compile errors)
  let viable_mutations = total - compile_errors;
  let behavioral_rate = if viable_mutations > 0 {
    (behavioral_kills as f64 / viable_mutations as f64) * 100.0
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
  
  // Use behavioral kill rate as the primary quality metric (exclude compile errors)
  let viable_mutations = total_mutations - compile_errors;
  let kill_rate = if viable_mutations > 0 {
    (behavioral_kills as f64 / viable_mutations as f64) * 100.0
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
  println!("Mutation Testing Results");
  println!("─────────────────────────");
  let viable_mutations = stats.total - stats.compile_errors;
  println!("Total mutations: {} ({} viable)", stats.total, viable_mutations);
  println!("Behavioral kills: {} ({:.1}%)", stats.behavioral_kills, stats.behavioral_rate);
  if stats.compile_errors > 0 {
    println!("Compile errors: {} (excluded from quality calculation)", stats.compile_errors);
  }
  println!("Survived: {}", stats.survived);
  println!("Test quality: {:.1}%", stats.behavioral_rate);
  println!("Duration: {:.1}s ({:.1} mut/sec)", 
    duration.as_secs_f64(), 
    stats.total as f64 / duration.as_secs_f64()
  );
}

/// Print per-file breakdown in table format
fn print_per_file_breakdown(per_file_stats: &[FileStats]) {
  println!();
  println!("Per-file results:");
  
  // Only show files with survivors or low behavioral kill rates
  let problematic_files: Vec<_> = per_file_stats
    .iter()
    .filter(|fs| fs.kill_rate < 95.0 && fs.total_mutations > 0)
    .collect();

  if problematic_files.is_empty() {
    println!("All files have excellent test coverage (≥95% behavioral kill rate)");
  } else {
    for file_stat in problematic_files {
      let short_path = file_stat.file_path
        .replace("src/cli/", "")
        .replace("/tmp/", "")
        .split("/pathogen-workspace/")
        .last()
        .unwrap_or(&file_stat.file_path)
        .to_string();
      
      println!("  {} - {:.0}% behavioral kills ({} survivors)", 
        short_path, file_stat.kill_rate, file_stat.survived);
    }
  }
}

/// Print a single file's stats as a table row
fn print_file_table_row(file_stat: &FileStats) {
  // Convert temp workspace path back to src/ relative path
  let display_path = if file_stat.file_path.contains("pathogen-workspace/") {
    // Extract the part after "pathogen-workspace/"
    file_stat
      .file_path
      .split("pathogen-workspace/")
      .last()
      .unwrap_or(&file_stat.file_path)
      .to_string()
  } else {
    file_stat.file_path.clone()
  };

  let status_icon = get_status_icon(file_stat.kill_rate);

  let truncated_path = if display_path.len() > 38 {
    display_path[..35].to_owned() + "..."
  } else {
    display_path
  };

  println!(
    "{} {:<38} {:>8} {:>8} {:>9} {:>8.1}%",
    status_icon,
    truncated_path,
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
  println!(
    "📄 {} ({} survivors):",
    short_path,
    file_stat.survived_mutations.len()
  );

  for (i, survivor) in file_stat.survived_mutations.iter().enumerate() {
    if i >= 5 {
      // Limit to first 5 for readability
      println!(
        "     ... and {} more (see JSON report for full list)",
        file_stat.survived_mutations.len() - 5
      );
      break;
    }
    println!(
      "     • Line {}: {} → {}",
      survivor.line, survivor.original, survivor.mutated
    );
  }
}

/// Print final assessment and warnings
fn print_final_assessment(stats: &SummaryStats, results: &[types::MutationResult]) {
  detect_and_warn_issues(stats, results);

  let grade_text = if stats.behavioral_rate >= 95.0 {
    "Excellent"
  } else if stats.behavioral_rate >= 80.0 {
    "Good"
  } else if stats.behavioral_rate >= 60.0 {
    "Moderate"
  } else {
    "Needs improvement"
  };

  println!();
  println!("Test quality: {} ({:.1}% behavioral kill rate)", grade_text, stats.behavioral_rate);
}

/// Detect and warn about common pathogen configuration issues
fn detect_and_warn_issues(stats: &SummaryStats, results: &[types::MutationResult]) {
  let mut warnings = Vec::new();

  if stats.behavioral_rate >= 99.5 && stats.total > 100 {
    warnings.push("Suspiciously high kill rate - check test detection".to_string());
  }

  let no_matches_count = results
    .iter()
    .filter(|r| r.test_output.contains("had no matches"))
    .count();
  
  if no_matches_count > 0 {
    warnings.push(format!("{} mutations found no matching test files", no_matches_count));
  }

  let timeout_count = results
    .iter()
    .filter(|r| r.test_output.contains("timeout") || r.test_output.contains("timed out"))
    .count();
  
  if timeout_count > stats.total / 20 {
    warnings.push(format!("{} mutations timed out", timeout_count));
  }

  if !warnings.is_empty() {
    println!();
    println!("Warnings:");
    for warning in warnings {
      println!("  • {}", warning);
    }
  }
}

fn __check_unrealistic_kill_rate(stats: &SummaryStats) -> u32 {
  if stats.behavioral_rate >= 99.5 && stats.total > 100 {
    println!("❌ SUSPICIOUS: 100% behavioral kill rate is unrealistic");
    println!("   • Likely issue: Missing test files or incorrect test detection");
    println!("   • Expected: 70-90% behavioral kills, 5-15% survivors, 5-15% compile errors");
    return 1;
  }
  0
}

fn __check_missing_test_files(results: &[types::MutationResult]) -> u32 {
  let no_matches_count = results
    .iter()
    .filter(|r| r.test_output.contains("had no matches"))
    .count();

  if no_matches_count > 0 {
    println!(
      "❌ DETECTED: {} mutations found no matching test files",
      no_matches_count
    );
    println!(
      "   • {} mutations fell back to full test suite",
      no_matches_count
    );
    println!("   • Consider creating missing test files or improving test selection");
    return 1;
  }
  0
}

fn __check_empty_outputs(results: &[types::MutationResult]) -> u32 {
  let empty_outputs = results
    .iter()
    .filter(|r| r.test_output.is_empty() || r.test_output == "null")
    .count();

  if empty_outputs > 0 {
    println!(
      "❌ DETECTED: {} mutations have empty test outputs",
      empty_outputs
    );
    println!("   • Tests may not be executing properly");
    println!("   • Check worker communication and test execution");
    return 1;
  }
  0
}

fn __check_timeout_patterns(results: &[types::MutationResult], stats: &SummaryStats) -> u32 {
  let timeout_count = results
    .iter()
    .filter(|r| r.test_output.contains("timed out") || r.test_output.contains("timeout"))
    .count();

  if timeout_count > stats.total / 20 {
    println!(
      "⚠️  WARNING: {} mutations timed out ({}%)",
      timeout_count,
      (timeout_count * 100) / stats.total
    );
    println!("   • May indicate infinite loop mutations");
    println!("   • Consider adjusting timeout values or mutation operators");
    return 1;
  }
  0
}

fn __check_execution_time_anomalies(
  results: &[types::MutationResult],
  stats: &SummaryStats,
) -> u32 {
  let very_fast_mutations = results.iter().filter(|r| r.execution_time_ms < 10).count();

  if very_fast_mutations > stats.total / 10 {
    println!(
      "⚠️  WARNING: {} mutations completed in <10ms ({}%)",
      very_fast_mutations,
      (very_fast_mutations * 100) / stats.total
    );
    println!("   • Tests may not be running properly");
    println!("   • Check if targeted test selection is working");
    return 1;
  }
  0
}

fn __check_compile_error_ratio(stats: &SummaryStats) -> u32 {
  if stats.compile_errors > stats.behavioral_kills {
    println!("⚠️  WARNING: More compile errors than behavioral kills!");
    println!("   • Consider refining mutation operators");
    println!("   • May indicate syntax-heavy mutations that don't test logic");
    return 1;
  }
  0
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
