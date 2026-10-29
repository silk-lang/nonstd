//! Published Unicode implementations used as performance references, not Unicode 18 oracles.
use icu_segmenter::{GraphemeClusterSegmenter, LineSegmenter, SentenceSegmenter};
use std::{error::Error, hint::black_box, process::ExitCode};
use unicode_bidi::BidiInfo;
use unicode_segmentation::UnicodeSegmentation;

const OFFSET: u64 = 14_695_981_039_346_656_037;
const PRIME: u64 = 1_099_511_628_211;

fn mix(hash: u64, value: u64) -> u64 {
    (hash ^ value).wrapping_mul(PRIME)
}

fn boundaries(indices: impl Iterator<Item = usize>, output: &mut Vec<usize>) -> (u64, u64) {
    output.clear();
    output.extend(indices);
    output
        .iter()
        .copied()
        .fold((OFFSET, 0), |(hash, count), index| {
            (mix(hash, index as u64), count + 1)
        })
}

fn bidi(text: &str) -> (u64, u64) {
    let info = BidiInfo::new(text, None);
    let mut hash = OFFSET;
    let mut count = 0;
    for paragraph in &info.paragraphs {
        // L1 with the complete paragraph on one line, matching unwrappedLevel.
        let levels = info.reordered_levels(paragraph, paragraph.range.clone());
        for (offset, _) in text[paragraph.range.clone()].char_indices() {
            let byte = paragraph.range.start + offset;
            hash = mix(mix(hash, byte as u64), u64::from(levels[byte].number()));
            count += 1;
        }
    }
    (hash, count)
}

fn repeat(iterations: u32, mut sample: impl FnMut() -> (u64, u64)) -> (u64, u64) {
    let mut hash = 0_u64;
    let mut count = 0_u64;
    for _ in 0..iterations {
        let result = black_box(sample());
        hash = hash.wrapping_add(result.0);
        count = count.wrapping_add(result.1);
    }
    (hash, count)
}

fn run() -> Result<(), Box<dyn Error>> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() == 2 && args[1] == "--version" {
        println!(
            "unicode-bidi 0.3.18 (Unicode {:?}); unicode-linebreak 0.1.5 (Unicode {:?}); unicode-segmentation 1.12.0; ICU4X segmenter 2.4.0 (stable constructors)",
            unicode_bidi::UNICODE_VERSION, unicode_linebreak::UNICODE_VERSION
        );
        return Ok(());
    }
    if args.len() != 4 {
        return Err(
            "usage: rust-ucd-bench bidi|line|icu-line|grapheme|word|sentence FILE ITERATIONS"
                .into(),
        );
    }
    let iterations: u32 = args[3].parse()?;
    if !(1..=100_000).contains(&iterations) {
        return Err("iterations must be in 1..=100000".into());
    }
    let text = std::fs::read_to_string(&args[2])?;
    let mut output = Vec::new();
    let result = match args[1].as_str() {
        "bidi" => repeat(iterations, || bidi(&text)),
        "line" => repeat(iterations, || {
            boundaries(
                unicode_linebreak::linebreaks(&text).map(|(index, _)| index),
                &mut output,
            )
        }),
        "icu-line" => {
            let segmenter = LineSegmenter::new_for_non_complex_scripts(Default::default());
            repeat(iterations, || {
                boundaries(
                    segmenter.segment_str(&text).filter(|index| *index != 0),
                    &mut output,
                )
            })
        }
        "grapheme" => {
            let segmenter = GraphemeClusterSegmenter::new();
            repeat(iterations, || {
                boundaries(segmenter.segment_str(&text), &mut output)
            })
        }
        "word" => repeat(iterations, || {
            // Default UAX29, including CJK. ICU's non-complex constructor does
            // not support CJK and is not an equivalent reference for this API.
            boundaries(
                text.split_word_bound_indices()
                    .map(|(index, _)| index)
                    .chain(std::iter::once(text.len())),
                &mut output,
            )
        }),
        "sentence" => {
            let segmenter = SentenceSegmenter::new(Default::default());
            repeat(iterations, || {
                boundaries(segmenter.segment_str(&text), &mut output)
            })
        }
        _ => return Err("unknown benchmark algorithm".into()),
    };
    println!("{} {}", result.0, result.1);
    Ok(())
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("rust-ucd-bench: {error}");
            ExitCode::from(2)
        }
    }
}
