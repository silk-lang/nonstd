// Copyright 2026 the Fontations Authors. Licensed under Apache-2.0 or MIT.
use read_fonts::{
    collections::IntSet,
    tables::layout::{ClassDef, CoverageTable},
    types::GlyphId,
};
use std::io::{self, Write};
fn queries() -> [IntSet<GlyphId>; 3] {
    [
        IntSet::empty(),
        [
            0,
            1,
            2,
            10,
            255,
            256,
            511,
            512,
            65535,
            65536,
            70000,
            16777215,
            u32::MAX,
        ]
        .into_iter()
        .map(GlyphId::new)
        .collect(),
        (0..=64).map(GlyphId::new).collect(),
    ]
}
fn glyphs(out: &mut impl Write, path: &str, set: &IntSet<GlyphId>) -> io::Result<()> {
    writeln!(out, "{path}.length={}", set.len())?;
    for (i, glyph) in set.iter().enumerate() {
        writeln!(out, "{path}[{i}]={}", glyph.to_u32())?;
    }
    Ok(())
}
pub fn coverage(out: &mut impl Write, path: &str, table: &CoverageTable<'_>) -> io::Result<()> {
    for (i, query) in queries().into_iter().enumerate() {
        let path = &format!("{path}.intersections[{i}]");
        writeln!(out, "{path}.intersects={}", table.intersects(&query))?;
        glyphs(out, &format!("{path}.glyphs"), &table.intersect_set(&query))?;
    }
    Ok(())
}
pub fn classes(out: &mut impl Write, path: &str, table: &ClassDef<'_>) -> io::Result<()> {
    for (i, query) in queries().into_iter().enumerate() {
        let path = &format!("{path}.intersections[{i}]");
        let classes = table.intersect_classes(&query);
        writeln!(out, "{path}.classes.length={}", classes.len())?;
        for (i, class) in classes.iter().enumerate() {
            writeln!(out, "{path}.classes[{i}]={class}")?;
        }
        for class in [0, 1, 2, 3, 65535, 65536, u32::MAX] {
            let child = &format!("{path}.byClass[{class}]");
            writeln!(
                out,
                "{child}.intersects={}",
                table.intersects_class_glyphs(&query, class)
            )?;
            glyphs(
                out,
                &format!("{child}.glyphs"),
                &table.intersected_class_glyphs(&query, class),
            )?;
        }
    }
    Ok(())
}
