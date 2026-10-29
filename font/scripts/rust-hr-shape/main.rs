use std::{error::Error, path::Path};

fn benchmark(font_path: &Path, text_path: &Path, repeat: u32) -> Result<(), Box<dyn Error>> {
    let font = harfrust::Font::new(std::fs::read(font_path)?, 0).ok_or("invalid font")?;
    let instance = font.instance_builder().build();
    let shaper = harfrust::ShaperFont::new(&instance);
    let text = std::fs::read_to_string(text_path)?;
    let mut buffer = harfrust::Buffer::new();
    let mut plans: Vec<harfrust::ShapePlan> = Vec::new();
    let mut checksum = 2166136261u64;
    let mut glyphs = 0u64;
    for _ in 0..repeat {
        for line in text.trim().split('\n') {
            buffer.clear();
            buffer.push_str(line);
            buffer.guess_segment_properties();
            let key = harfrust::ShapePlanKey::new(&instance, buffer.script(), buffer.direction())
                .language(buffer.language());
            let index = plans
                .iter()
                .position(|plan| key.matches(plan))
                .unwrap_or_else(|| {
                    plans.push(harfrust::ShapePlan::new(
                        &instance,
                        buffer.direction(),
                        buffer.script(),
                        buffer.language(),
                        &[],
                    ));
                    plans.len() - 1
                });
            harfrust::shape(
                &shaper,
                &mut buffer,
                harfrust::ShapeOptions::new().plan(Some(&plans[index])),
            )?;
            for (info, pos) in buffer.glyph_infos().iter().zip(buffer.glyph_positions()) {
                for value in [
                    info.glyph_id,
                    info.cluster,
                    pos.x_advance as u32,
                    pos.y_advance as u32,
                    pos.x_offset as u32,
                    pos.y_offset as u32,
                ] {
                    checksum = (checksum ^ u64::from(value)).wrapping_mul(16777619);
                }
                glyphs += 1;
            }
        }
    }
    println!("{checksum} {glyphs}");
    Ok(())
}

fn main() {
    let args: Vec<_> = std::env::args_os().collect();
    if args.get(1).is_some_and(|arg| arg == "--case") {
        let result = (|| -> Result<String, Box<dyn Error>> {
            if args.len() != 5 {
                return Err("usage: --case FONT TEXT_FILE OPTIONS".into());
            }
            let text = std::fs::read_to_string(&args[3])?;
            Ok(hr_shape::shape(
                args[2].to_str().ok_or("invalid font path")?,
                &text,
                args[4].to_str().ok_or("invalid options")?,
            )?)
        })();
        match result {
            Ok(output) => println!("{output}"),
            Err(error) => {
                eprintln!("{error}");
                std::process::exit(1);
            }
        }
    } else if args.get(1).is_some_and(|arg| arg == "--bench") {
        let result = (|| {
            if args.len() != 5 {
                return Err("usage: --bench FONT TEXT_FILE ITERATIONS".into());
            }
            let repeat: u32 = args[4].to_str().ok_or("invalid count")?.parse()?;
            if repeat == 0 || repeat > 100_000 {
                return Err("invalid count".into());
            }
            benchmark(Path::new(&args[2]), Path::new(&args[3]), repeat)
        })();
        if let Err(error) = result {
            eprintln!("{error}");
            std::process::exit(1);
        }
    } else if let Err(error) = hr_shape::try_main() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
