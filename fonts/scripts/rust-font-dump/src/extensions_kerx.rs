// Copyright 2022 the Fontations Authors. Licensed under Apache-2.0 or MIT.
use crate::extensions_aat_common::*;
use read_fonts::{tables::kerx::*, types::*, FontData, FontRef, TableProvider};
use std::io::{self, Write};
pub fn dump(out: &mut impl Write, path: &str, font: &FontRef<'_>) -> io::Result<()> {
    let count = font.selected_maxp().map(|x| x.num_glyphs()).unwrap_or(0);
    let path = &format!("{path}.kerxKinds");
    match font.kerx() {
        Ok(value) => {
            for (i, result) in value.subtables().iter().enumerate() {
                let path = &format!("{path}.subtables[{i}]");
                match result {
                    Ok(table) => dump_subtable(out, path, table, count)?,
                    Err(error) => writeln!(out, "{path}.error={}", crate::error(error))?,
                }
            }
        }
        Err(error) => writeln!(out, "{path}.error={}", crate::error(error))?,
    }
    Ok(())
}
fn dump_subtable(
    out: &mut impl Write,
    path: &str,
    subtable: Subtable<'_>,
    count: u32,
) -> io::Result<()> {
    let data = FontData::new(subtable.data());
    writeln!(out, "{path}.isVertical={}", subtable.is_vertical())?;
    writeln!(out, "{path}.isHorizontal={}", subtable.is_horizontal())?;
    writeln!(out, "{path}.isCrossStream={}", subtable.is_cross_stream())?;
    writeln!(out, "{path}.isVariable={}", subtable.is_variable())?;
    writeln!(
        out,
        "{path}.processDirection={}",
        subtable.process_direction()
    )?;
    let path = &format!("{path}.kind");
    match subtable.kind() {
        Ok(kind) => match kind {
            SubtableKind::Format0(value) => {
                writeln!(out, "{path}=Format0")?;
                crate::dump_support::begin_table();
                crate::generated_dump_kerx::dump_Subtable0(out, path, &value)?;
                for (i, pair) in value.pairs().iter().enumerate() {
                    match value.kerning(pair.left().into(), pair.right().into()) {
                        Some(adjustment) => writeln!(out, "{path}.pairLookups[{i}]={adjustment}")?,
                        None => writeln!(out, "{path}.pairLookups[{i}]=none")?,
                    }
                }
                probes0(out, path, &value, count)?;
            }
            SubtableKind::Format1(value) => {
                writeln!(out, "{path}=Format1")?;
                dump_extended_state(
                    out,
                    &format!("{path}.state"),
                    &value.state_table,
                    data,
                    count,
                )?;
                dump_array(out, &format!("{path}.values"), value.values)?;
            }
            SubtableKind::Format2(value) => {
                writeln!(out, "{path}=Format2")?;
                dump_lookup_u16(
                    out,
                    &format!("{path}.leftOffsetTable"),
                    &value.left_offset_table,
                    count,
                )?;
                dump_lookup_u16(
                    out,
                    &format!("{path}.rightOffsetTable"),
                    &value.right_offset_table,
                    count,
                )?;
                dump_array(out, &format!("{path}.array"), value.array)?;
                probes2(out, path, &value, count)?;
            }
            SubtableKind::Format4(value) => {
                writeln!(out, "{path}=Format4")?;
                dump_extended_state(
                    out,
                    &format!("{path}.state"),
                    &value.state_table,
                    data,
                    count,
                )?;
                writeln!(out, "{path}.flags={}", value.flags)?;
                let path = &format!("{path}.actions");
                match &value.actions {
                    Subtable4Actions::ControlPoints(values) => {
                        writeln!(out, "{path}=ControlPoints")?;
                        dump_array(out, path, values)?;
                    }
                    Subtable4Actions::AnchorPoints(values) => {
                        writeln!(out, "{path}=AnchorPoints")?;
                        dump_array(out, path, values)?;
                    }
                    Subtable4Actions::ControlPointCoords(values) => {
                        writeln!(out, "{path}=ControlPointCoords")?;
                        dump_array(out, path, values)?;
                    }
                }
            }
            SubtableKind::Format6(value) => {
                writeln!(out, "{path}=Format6")?;
                probes6(out, path, &value, count)?;
                match value {
                    Subtable6::ShortValues(rows, columns, array, vector) => {
                        writeln!(out, "{path}.valueKind=ShortValues")?;
                        dump_lookup_u16(out, &format!("{path}.rows"), &rows, count)?;
                        dump_lookup_u16(out, &format!("{path}.columns"), &columns, count)?;
                        dump_array(out, &format!("{path}.array"), array)?;
                        match vector {
                            Some(values) => dump_array(out, &format!("{path}.vector"), values)?,
                            None => writeln!(out, "{path}.vector=none")?,
                        }
                    }
                    Subtable6::LongValues(rows, columns, array, vector) => {
                        writeln!(out, "{path}.valueKind=LongValues")?;
                        dump_lookup_u32(out, &format!("{path}.rows"), &rows, count)?;
                        dump_lookup_u32(out, &format!("{path}.columns"), &columns, count)?;
                        dump_array(out, &format!("{path}.array"), array)?;
                        match vector {
                            Some(values) => dump_array(out, &format!("{path}.vector"), values)?,
                            None => writeln!(out, "{path}.vector=none")?,
                        }
                    }
                }
            }
        },
        Err(error) => writeln!(out, "{path}.error={}", crate::error(error))?,
    }
    Ok(())
}
fn probes0(out: &mut impl Write, path: &str, value: &Subtable0<'_>, count: u32) -> io::Result<()> {
    let glyphs = [0, 1, 2, 31, count.saturating_sub(1), count, 65535, 65536];
    for (i, left) in glyphs.into_iter().enumerate() {
        for (j, right) in glyphs.into_iter().enumerate() {
            let path = &format!("{path}.kernings[{}]", i * 8 + j);
            match value.kerning(GlyphId::new(left), GlyphId::new(right)) {
                Some(adjustment) => writeln!(out, "{path}={adjustment}")?,
                None => writeln!(out, "{path}=none")?,
            }
        }
    }
    Ok(())
}
fn probes2(out: &mut impl Write, path: &str, value: &Subtable2<'_>, count: u32) -> io::Result<()> {
    let glyphs = [0, 1, 2, 31, count.saturating_sub(1), count, 65535, 65536];
    for (i, left) in glyphs.into_iter().enumerate() {
        for (j, right) in glyphs.into_iter().enumerate() {
            let path = &format!("{path}.kernings[{}]", i * 8 + j);
            match value.kerning(GlyphId::new(left), GlyphId::new(right)) {
                Some(adjustment) => writeln!(out, "{path}={adjustment}")?,
                None => writeln!(out, "{path}=none")?,
            }
        }
    }
    Ok(())
}
fn probes6(out: &mut impl Write, path: &str, value: &Subtable6<'_>, count: u32) -> io::Result<()> {
    let glyphs = [0, 1, 2, 31, count.saturating_sub(1), count, 65535, 65536];
    for (i, left) in glyphs.into_iter().enumerate() {
        for (j, right) in glyphs.into_iter().enumerate() {
            let path = &format!("{path}.kernings[{}]", i * 8 + j);
            match value.kerning(GlyphId::new(left), GlyphId::new(right)) {
                Some(adjustment) => writeln!(out, "{path}={adjustment}")?,
                None => writeln!(out, "{path}=none")?,
            }
        }
    }
    Ok(())
}
