use std::collections::HashMap;

/// Counts how often each word appears.
pub fn word_counts(text: &str) -> HashMap<&str, usize> {
    let mut counts = HashMap::new();
    for word in text.split_whitespace() {
        *counts.entry(word).or_insert(0) += 1;
    }
    counts
}

#[derive(Debug, Clone, PartialEq)]
enum Message<'a> { Quit, Write(&'a str), Move { x: i32, y: i32 } }

impl<'a> Message<'a> {
    fn describe(&self) -> String {
        match self {
            Message::Quit => "quit".to_string(),
            Message::Write(text) => format!("write {text:?}"),
            Message::Move { x, y } => format!("move {x}, {y}"),
        }
    }
}

fn main() { let n: u64 = 0xff_u64 << 2; println!("{}", n as f64 / 2.0); }
