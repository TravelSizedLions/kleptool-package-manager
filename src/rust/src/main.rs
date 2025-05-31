use std::env;

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() != 4 {
        eprintln!("Usage: native-calc <add|subtract> <a> <b>");
        std::process::exit(1);
    }
    let op = &args[1];
    let a: i32 = args[2].parse().unwrap();
    let b: i32 = args[3].parse().unwrap();

    let result = match op.as_str() {
        "add" => a + b,
        "subtract" => a - b,
        _ => {
            eprintln!("Unknown operation");
            std::process::exit(1);
        }
    };
    println!("{}", result);
}