use anyhow::Result;
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

  print_startup_banner(&config);
  let start_time = Instant::now();

  let mut components = initialize_components(&config)?;
  let target_files = discover_and_validate_files(&config)?;

  if !config.dry_run {
    run_baseline_validation(&components.runner).await?;
  }

  let mutations = generate_mutations(&mut components, &target_files, config.verbose)?;

  if config.dry_run {
    handle_dry_run(&mutations, config.verbose);
    return Ok(());
  }

  let results = run_mutation_tests(&components.runner, mutations, config.verbose).await?;
  let duration = start_time.elapsed();

  generate_and_save_report(&results, &target_files, duration, &config)?;
  print_completion_summary(&results, duration);

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
        .help("Number of parallel test runners")
        .default_value("4"),
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
    .get_matches()
}

/// Print the startup banner with configuration info
fn print_startup_banner(config: &MutationConfig) {
  println!("🦀 Klep Mutation Tester v2 - AST Edition");
  println!("🛡️  Safe, fast, behavioral coverage analysis");
  println!("📂 Source directory: {}", config.source_dir.display());
  println!("🔧 Parallel runners: {}", config.parallel_count);
  if config.dry_run {
    println!("🔍 DRY RUN MODE - No tests will be executed");
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
  let runner = MutationRunner::new(config.parallel_count, file_manager)?;

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
  println!("\n📊 Running baseline tests...");
  if !runner.run_baseline_tests().await? {
    anyhow::bail!("❌ Baseline tests are failing! Fix tests before running mutation testing.");
  }
  println!("✅ Baseline tests pass");
  Ok(())
}

/// Generate mutations from AST analysis
fn generate_mutations(
  components: &mut MutationComponents,
  target_files: &[PathBuf],
  verbose: bool,
) -> Result<Vec<types::Mutation>> {
  println!("\n🧬 Parsing ASTs and generating mutations...");
  let mutations = generate_mutations_from_ast(
    &mut components.parser,
    &components.engine,
    target_files,
    verbose,
  )?;
  println!("🎭 Generated {} total mutations", mutations.len());
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
  println!("\n⚡ Running parallel mutation tests with bulletproof file safety...");
  runner.run_mutations_safely(mutations, verbose).await
}

/// Generate and save the final report
fn generate_and_save_report(
  results: &[types::MutationResult],
  target_files: &[PathBuf],
  duration: std::time::Duration,
  config: &MutationConfig,
) -> Result<()> {
  println!("\n🎯 Generating comprehensive report...");
  let stats = generate_report(results, target_files, duration);

  if let Some(output_path) = &config.output_file {
    save_results_to_file(results, &stats, output_path)?;
    println!("💾 Results saved to: {}", output_path.display());
  }

  Ok(())
}

/// Print completion summary
fn print_completion_summary(results: &[types::MutationResult], duration: std::time::Duration) {
  println!("\n✨ Mutation testing complete!");
  println!(
    "⏱️  Total time: {:.2}s | 🚀 Rate: {:.1} mutations/sec",
    duration.as_secs_f64(),
    results.len() as f64 / duration.as_secs_f64()
  );
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
  println!("\n🎯 COMPREHENSIVE MUTATION TESTING RESULTS");
  println!("{}", "=".repeat(60));
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

/// Print per-file breakdown
fn print_per_file_breakdown(per_file_stats: &[FileStats]) {
  println!("\n📁 PER-FILE COVERAGE BREAKDOWN");
  println!("{}", "=".repeat(60));
  for file_stat in per_file_stats {
    print_file_stats(file_stat);
  }
}

/// Print statistics for a single file
fn print_file_stats(file_stat: &FileStats) {
  let status_icon = get_status_icon(file_stat.kill_rate);

  println!(
    "{} {} ({:.1}% kill rate)",
    status_icon,
    file_stat.file_path.replace("src/cli/", ""),
    file_stat.kill_rate
  );
  println!(
    "   {} mutations | {} kills | {} survived",
    file_stat.total_mutations,
    file_stat.behavioral_kills + file_stat.compile_errors,
    file_stat.survived
  );

  print_survivors_info(file_stat);
  println!();
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

/// Print information about survived mutations
fn print_survivors_info(file_stat: &FileStats) {
  if !file_stat.survived_mutations.is_empty() && file_stat.survived_mutations.len() <= 3 {
    println!("   Survivors:");
    for survivor in &file_stat.survived_mutations {
      println!(
        "     • Line {}: {} → {}",
        survivor.line, survivor.original, survivor.mutated
      );
    }
  } else if file_stat.survived_mutations.len() > 3 {
    println!(
      "   {} survivors (see JSON report for details)",
      file_stat.survived_mutations.len()
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
