// Copyright 2022 the Fontations Authors. Licensed under Apache-2.0 or MIT.
use read_fonts::{tables::math::*, types::GlyphId, FontRef, TableProvider};
use std::io::{self, Write};
fn value(out: &mut impl Write, path: &str, value: MathValue) -> io::Result<()> {
    writeln!(out, "{path}.value={}", value.value)?;
    writeln!(out, "{path}.deltaPx={}", value.delta_px)
}
pub fn dump(out: &mut impl Write, path: &str, font: &FontRef<'_>) -> io::Result<()> {
    let Ok(math) = font.math() else { return Ok(()) };
    let path = &format!("{path}.mathQueries");
    writeln!(
        out,
        "{path}.hasSwappedMinHeights={}",
        math.has_swapped_min_heights()
    )?;
    let sizes = [0, 10, 11, 12, 16, 24];
    if let Ok(constants) = math.math_constants() {
        for (i, constant) in MathConstant::ALL.iter().enumerate() {
            for ppem in sizes {
                value(
                    out,
                    &format!("{path}.constants[{i}].ppem[{ppem}]"),
                    constants.constant_for_ppem(*constant, ppem),
                )?;
            }
        }
    }
    if let Some(kerns) = math
        .math_glyph_info()
        .ok()
        .and_then(|v| v.math_kern_info())
        .and_then(Result::ok)
    {
        for gid in [0, 9, 21, 42, 65535] {
            for (c, corner) in [
                MathKernCorner::TopRight,
                MathKernCorner::TopLeft,
                MathKernCorner::BottomRight,
                MathKernCorner::BottomLeft,
            ]
            .into_iter()
            .enumerate()
            {
                let path = &format!("{path}.glyphs[{gid}].corners[{c}]");
                let Some(kern) = kerns.kern(GlyphId::new(gid), corner) else {
                    writeln!(out, "{path}=none")?;
                    continue;
                };
                for (h, height) in [-1, 19, 20, 39, 40, 32767].into_iter().enumerate() {
                    match kern.kerning(height) {
                        Some(v) => writeln!(out, "{path}.heightQueries[{h}]={v}")?,
                        None => writeln!(out, "{path}.heightQueries[{h}]=none")?,
                    }
                }
                for ppem in sizes {
                    for (e, entry) in kern.entries_for_ppem(ppem).enumerate() {
                        let path = &format!("{path}.ppem[{ppem}].entries[{e}]");
                        match entry.max_height {
                            Some(v) => value(out, &format!("{path}.maxHeight"), v)?,
                            None => writeln!(out, "{path}.maxHeight=none")?,
                        }
                        value(out, &format!("{path}.kern"), entry.kern)?;
                    }
                }
            }
        }
    }
    Ok(())
}
