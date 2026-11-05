use read_fonts::{
    tables::hmtx::{Hmtx, HmtxExtended},
    types::GlyphId,
};
use std::io::{self, Write};
#[allow(non_snake_case)]
pub fn dump_Hmtx(out: &mut impl Write, path: &str, table: &Hmtx<'_>) -> io::Result<()> {
    let count = table.h_metrics().len() + table.left_side_bearings().len() + 2;
    writeln!(out, "{path}.metrics.length={count}")?;
    for i in 0..count {
        let glyph = GlyphId::new(i as u32);
        let path = format!("{path}.metrics[{i}]");
        match table.advance(glyph) {
            Some(value) => writeln!(out, "{path}.advance={value}")?,
            None => writeln!(out, "{path}.advance=none")?,
        }
        match table.side_bearing(glyph) {
            Some(value) => writeln!(out, "{path}.sideBearing={value}")?,
            None => writeln!(out, "{path}.sideBearing=none")?,
        }
    }
    Ok(())
}
#[allow(non_snake_case)]
pub fn dump_HmtxExtended(
    out: &mut impl Write,
    path: &str,
    table: &HmtxExtended<'_>,
) -> io::Result<()> {
    let count = table.h_metrics().len() + table.left_side_bearings().len() + 2;
    writeln!(out, "{path}.metrics.length={count}")?;
    for i in 0..count {
        let glyph = GlyphId::new(i as u32);
        let path = format!("{path}.metrics[{i}]");
        match table.advance(glyph) {
            Some(value) => writeln!(out, "{path}.advance={value}")?,
            None => writeln!(out, "{path}.advance=none")?,
        }
        match table.side_bearing(glyph) {
            Some(value) => writeln!(out, "{path}.sideBearing={value}")?,
            None => writeln!(out, "{path}.sideBearing=none")?,
        }
    }
    Ok(())
}

use read_fonts::tables::vmtx::{Vmtx, VmtxExtended};
#[allow(non_snake_case)]
pub fn dump_Vmtx(out: &mut impl Write, path: &str, table: &Vmtx<'_>) -> io::Result<()> {
    let count = table.v_metrics().len() + table.top_side_bearings().len() + 2;
    writeln!(out, "{path}.metrics.length={count}")?;
    for i in 0..count {
        let glyph = GlyphId::new(i as u32);
        let path = format!("{path}.metrics[{i}]");
        match table.advance(glyph) {
            Some(value) => writeln!(out, "{path}.advance={value}")?,
            None => writeln!(out, "{path}.advance=none")?,
        }
        match table.side_bearing(glyph) {
            Some(value) => writeln!(out, "{path}.sideBearing={value}")?,
            None => writeln!(out, "{path}.sideBearing=none")?,
        }
    }
    Ok(())
}
#[allow(non_snake_case)]
pub fn dump_VmtxExtended(
    out: &mut impl Write,
    path: &str,
    table: &VmtxExtended<'_>,
) -> io::Result<()> {
    let count = table.v_metrics().len() + table.top_side_bearings().len() + 2;
    writeln!(out, "{path}.metrics.length={count}")?;
    for i in 0..count {
        let glyph = GlyphId::new(i as u32);
        let path = format!("{path}.metrics[{i}]");
        match table.advance(glyph) {
            Some(value) => writeln!(out, "{path}.advance={value}")?,
            None => writeln!(out, "{path}.advance=none")?,
        }
        match table.side_bearing(glyph) {
            Some(value) => writeln!(out, "{path}.sideBearing={value}")?,
            None => writeln!(out, "{path}.sideBearing=none")?,
        }
    }
    Ok(())
}
