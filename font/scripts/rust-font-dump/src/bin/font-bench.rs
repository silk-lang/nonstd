//! Rust counterpart of font/parse/bench/src/workloads.silk: `font-bench WORKLOAD FONT` prints the
//! same checksum the Silk program prints.
use read_fonts::{
    model::glyph::outline::PathSink,
    ps::cff::CffFontRef,
    tables::{glyf::Glyph, loca::LocaGlyph},
    types::GlyphId,
    FontRef, TableProvider,
};

fn cmap(font: &FontRef) -> u64 {
    let Ok(table) = font.cmap() else { return 0 };
    let Some((_, _, subtable)) = table.best_subtable() else {
        return 0;
    };
    let mut sum = 0u64;
    for cp in 0..0x110000u32 {
        if let Some(gid) = subtable.map_codepoint(cp) {
            sum = sum.wrapping_add(gid.to_u32() as u64);
        }
    }
    sum
}

fn unsigned(value: i16) -> u64 {
    (value as i32 + 32768) as u64
}

fn glyf(font: &FontRef) -> u64 {
    let (Ok(loca), Ok(glyf)) = (font.loca(None), font.glyf()) else {
        return 0;
    };
    let mut sum = 0u64;
    for gid in 0..loca.len() {
        let Some(LocaGlyph::Glyph(glyph)) = loca.get(GlyphId::new(gid as u32), &glyf) else {
            continue;
        };
        match glyph {
            Glyph::Simple(simple) => {
                for point in simple.points() {
                    sum = sum.wrapping_add(unsigned(point.x) + unsigned(point.y));
                    if point.on_curve {
                        sum = sum.wrapping_add(1);
                    }
                }
            }
            Glyph::Composite(composite) => {
                for component in composite.components() {
                    sum = sum.wrapping_add(component.glyph.to_u32() as u64);
                }
            }
        }
    }
    sum
}

fn hmtx(font: &FontRef) -> u64 {
    let Ok(table) = font.hmtx() else { return 0 };
    let mut sum = 0u64;
    for gid in 0..65536u32 {
        if let Some(advance) = table.advance(GlyphId::new(gid)) {
            sum = sum.wrapping_add(advance as u64);
        }
    }
    sum
}

struct SumSink {
    sum: u64,
}

impl SumSink {
    fn add(&mut self, x: f32, y: f32) {
        let bits = (x.to_bits() as u64).wrapping_add(y.to_bits() as u64);
        self.sum = self.sum.wrapping_add(bits.wrapping_add(1));
    }
}

impl PathSink for SumSink {
    fn move_to(&mut self, x: f32, y: f32) {
        self.add(x, y);
    }
    fn line_to(&mut self, x: f32, y: f32) {
        self.add(x, y);
    }
    fn quad_to(&mut self, cx: f32, cy: f32, x: f32, y: f32) {
        self.add(cx, cy);
        self.add(x, y);
    }
    fn curve_to(&mut self, cx0: f32, cy0: f32, cx1: f32, cy1: f32, x: f32, y: f32) {
        self.add(cx0, cy0);
        self.add(cx1, cy1);
        self.add(x, y);
    }
    fn close(&mut self) {
        self.sum = self.sum.wrapping_add(1);
    }
}

fn cff(font: &FontRef, only_subfont: bool) -> u64 {
    let bytes = match font.cff() {
        Ok(table) => table.offset_data().as_bytes(),
        Err(_) => match font.cff2() {
            Ok(table) => table.offset_data().as_bytes(),
            Err(_) => return 0,
        },
    };
    let Ok(outlines) = CffFontRef::new(bytes, 0, None) else {
        return 0;
    };
    let mut sink = SumSink { sum: 0 };
    for gid in 0..outlines.num_glyphs() {
        let glyph = GlyphId::new(gid);
        let Some(index) = outlines.subfont_index(glyph) else {
            continue;
        };
        let Ok(subfont) = outlines.subfont(index, &[]) else {
            continue;
        };
        if only_subfont {
            sink.sum = sink.sum.wrapping_add(subfont.subrs_offset() as u64);
            continue;
        }
        if outlines.draw(&subfont, glyph, &[], None, &mut sink).is_ok() {
            sink.sum = sink.sum.wrapping_add(1);
        }
    }
    sink.sum
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 3 {
        eprintln!("usage: font-bench cmap|glyf|hmtx|cff|cffsub FONT");
        std::process::exit(2);
    }
    let data = std::fs::read(&args[2]).unwrap_or_else(|_| {
        eprintln!("font-bench: unable to read input");
        std::process::exit(2)
    });
    let checksum = match FontRef::new(&data) {
        Ok(font) => match args[1].as_str() {
            "cmap" => cmap(&font),
            "glyf" => glyf(&font),
            "hmtx" => hmtx(&font),
            "cff" => cff(&font, false),
            "cffsub" => cff(&font, true),
            _ => {
                eprintln!("font-bench: unknown workload");
                std::process::exit(2);
            }
        },
        Err(_) => 0,
    };
    println!("{checksum}");
}
