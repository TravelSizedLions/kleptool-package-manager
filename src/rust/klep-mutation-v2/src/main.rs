use anyhow::Result;
use clap::{Arg, Command};
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
  let matches = Command::new("klep-mutation-v2")
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
    .get_matches();

  let config = MutationConfig::from_args(&matches)?;

  println!("🦀 Klep Mutation Tester v2 - AST Edition");
  println!("🛡️  Safe, fast, behavioral coverage analysis");
  println!("📂 Source directory: {}", config.source_dir.display());
  println!("🔧 Parallel runners: {}", config.parallel_count);
  if config.dry_run {
    println!("🔍 DRY RUN MODE - No tests will be executed");
  }

  let start_time = Instant::now();

  // Initialize components with safety-first design
  let mut parser = TypeScriptParser::new()?;
  let file_manager = SafeFileManager::new()?;
  let mutation_engine = MutationEngine::new()?;
  let runner = MutationRunner::new(config.parallel_count, file_manager)?;

  println!("\n🔍 Discovering TypeScript files...");
  let target_files = discover_target_files(&config.source_dir)?;
  println!("🎯 Found {} files to analyze", target_files.len());

  if config.verbose {
    for file in &target_files {
      println!("   - {}", file.display());
    }
  }

  if !config.dry_run {
    println!("\n📊 Running baseline tests...");
    if !runner.run_baseline_tests().await? {
      anyhow::bail!("❌ Baseline tests are failing! Fix tests before running mutation testing.");
    }
    println!("✅ Baseline tests pass");
  }

  println!("\n🧬 Parsing ASTs and generating mutations...");
  let mutations =
    generate_mutations_from_ast(&mut parser, &mutation_engine, &target_files, config.verbose)?;
  println!("🎭 Generated {} total mutations", mutations.len());

  if config.dry_run {
    println!(
      "\n🔍 DRY RUN COMPLETE - Generated {} mutations safely",
      mutations.len()
    );
    if config.verbose {
      for (i, mutation) in mutations.iter().take(5).enumerate() {
        println!(
          "   Sample #{}: {} -> {}",
          i + 1,
          mutation.original,
          mutation.mutated
        );
      }
    }
    return Ok(());
  }

  println!("\n⚡ Running parallel mutation tests with bulletproof file safety...");
  let results = runner
    .run_mutations_safely(mutations, config.verbose)
    .await?;

  let duration = start_time.elapsed();
  println!("\n🎯 Generating comprehensive report...");
  let stats = generate_report(&results, &target_files, duration);

  if let Some(output_path) = &config.output_file {
    save_results_to_file(&results, &stats, output_path)?;
    println!("💾 Results saved to: {}", output_path.display());
  }

  println!("\n✨ Mutation testing complete!");
  println!(
    "⏱️  Total time: {:.2}s | 🚀 Rate: {:.1} mutations/sec",
    duration.as_secs_f64(),
    results.len() as f64 / duration.as_secs_f64()
  );

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
  use std::collections::HashMap;

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

  // Generate per-file statistics
  let mut file_results: HashMap<String, Vec<&types::MutationResult>> = HashMap::new();
  for result in results {
    let file_path = result.mutation.file.to_string_lossy().to_string();
    file_results.entry(file_path).or_default().push(result);
  }

  let mut per_file_stats: Vec<FileStats> = file_results
    .into_iter()
    .map(|(file_path, file_mutations)| {
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
    })
    .collect();

  // Sort by kill rate (lowest first - files needing most attention)
  per_file_stats.sort_by(|a, b| {
    a.kill_rate
      .partial_cmp(&b.kill_rate)
      .unwrap_or(std::cmp::Ordering::Equal)
  });

  println!("\n🎯 COMPREHENSIVE MUTATION TESTING RESULTS");
  println!("{}", "=".repeat(60));
  println!("📊 Total mutations: {}", total);
  println!(
    "🧬 Behavioral kills: {}/{} ({:.1}%)",
    behavioral_kills, total, behavioral_rate
  );
  println!(
    "⚠️  Compile errors: {}/{} ({:.1}%)",
    compile_errors,
    total,
    (compile_errors as f64 / total as f64) * 100.0
  );
  println!(
    "😱 Survived: {}/{} ({:.1}%)",
    survived,
    total,
    (survived as f64 / total as f64) * 100.0
  );
  println!(
    "💀 Total killed: {}/{} ({:.1}%)",
    behavioral_kills + compile_errors,
    total,
    kill_rate
  );
  println!("⏱️  Total time: {:.2}s", duration.as_secs_f64());
  println!(
    "🚀 Mutations per second: {:.1}",
    total as f64 / duration.as_secs_f64()
  );

  // Display per-file breakdown
  println!("\n📁 PER-FILE COVERAGE BREAKDOWN");
  println!("{}", "=".repeat(60));
  for file_stat in &per_file_stats {
    let status_icon = if file_stat.kill_rate >= 95.0 {
      "🟢"
    } else if file_stat.kill_rate >= 80.0 {
      "🟡"
    } else {
      "🔴"
    };

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
    println!();
  }

  let grade = if behavioral_rate >= 80.0 {
    "🟢 EXCELLENT behavioral coverage!"
  } else if behavioral_rate >= 60.0 {
    "🟡 GOOD behavioral coverage"
  } else {
    "🔴 Behavioral coverage needs improvement"
  };

  if compile_errors > behavioral_kills {
    println!("⚠️  WARNING: More compile errors than behavioral kills!");
    println!("🔧 Consider refining mutation operators");
  }
  println!("{}", grade);

  MutationStats {
    total_mutations: total,
    behavioral_kills,
    compile_errors,
    survived,
    duration: duration.as_secs_f64(),
    files_tested: target_files.len(),
    per_file_stats,
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
