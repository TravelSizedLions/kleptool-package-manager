use anyhow::Result;
use clap::{Parser, Subcommand};
use std::path::PathBuf;

mod analyzer;
mod languages;
mod metrics;

#[derive(Parser)]
#[command(author, version, about, long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Check code for never-nester violations
    Check {
        /// Path to analyze
        #[arg(value_name = "PATH")]
        path: PathBuf,
        
        /// Maximum allowed nesting depth
        #[arg(long, default_value = "3")]
        max_depth: usize,
        
        /// Maximum allowed function length (lines)
        #[arg(long, default_value = "50")]
        max_length: usize,
        
        /// Maximum allowed cyclomatic complexity
        #[arg(long, default_value = "10")]
        max_complexity: usize,
        
        /// Output format
        #[arg(long, default_value = "text")]
        format: String,
    },
}

fn main() -> Result<()> {
    let cli = Cli::parse();

    match &cli.command {
        Commands::Check { path, max_depth, max_length, max_complexity, format: _ } => {
            let config = analyzer::AnalysisConfig {
                max_nesting_depth: *max_depth,
                max_function_length: *max_length,
                max_complexity: *max_complexity,
            };
            analyzer::analyze_path(path, &config)?;
        }
    }

    Ok(())
} 