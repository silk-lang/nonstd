// Copyright 2022 the Fontations Authors. Licensed under Apache-2.0 or MIT.
use crate::extensions_aat_common::*;
use read_fonts::{tables::kern::*, types::*, FontData, FontRef, TableProvider};
use std::io::{self, Write};
pub fn dump(out: &mut impl Write, path: &str, font: &FontRef<'_>) -> io::Result<()> {
    let count = font.selected_maxp().map(|x| x.num_glyphs()).unwrap_or(0);
    let path = &format!("{path}.kernKinds");
    match font.kern() {
        Ok(value) => {
            crate::dump_support::begin_table();
            match &value {
                Kern::Ot(table) => crate::generated_dump_kern::dump_OtKern(out, path, table)?,
                Kern::Aat(table) => crate::generated_dump_kern::dump_AatKern(out, path, table)?,
            }
            for (i, result) in value.subtables().enumerate() {
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
    crate::dump_support::begin_table();
    let data = match &subtable {
        Subtable::Ot(value) => {
            crate::generated_dump_kern::dump_OtSubtable(out, path, value)?;
            FontData::new(value.data())
        }
        Subtable::Aat(value) => {
            crate::generated_dump_kern::dump_AatSubtable(out, path, value)?;
            FontData::new(value.data())
        }
    };
    writeln!(out, "{path}.isVertical={}", subtable.is_vertical())?;
    writeln!(out, "{path}.isHorizontal={}", subtable.is_horizontal())?;
    writeln!(out, "{path}.isCrossStream={}", subtable.is_cross_stream())?;
    writeln!(out, "{path}.isVariable={}", subtable.is_variable())?;
    writeln!(out, "{path}.isStateMachine={}", subtable.is_state_machine())?;
    let path = &format!("{path}.kind");
    match subtable.kind() {
        Ok(kind) => match kind {
            SubtableKind::Format0(value) => {
                writeln!(out, "{path}=Format0")?;
                crate::dump_support::begin_table();
                crate::generated_dump_kern::dump_Subtable0(out, path, &value)?;
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
                dump_legacy_state(out, &format!("{path}.state"), &value, data, count)?;
            }
            SubtableKind::Format2(value) => {
                writeln!(out, "{path}=Format2")?;
                writeln!(out, "{path}.headerLen={}", value.header_len)?;
                writeln!(out, "{path}.arrayOffset={}", value.array_offset)?;
                crate::generated_dump_kern::dump_Subtable2ClassTable(
                    out,
                    &format!("{path}.leftOffsetTable"),
                    &value.left_offset_table,
                )?;
                crate::generated_dump_kern::dump_Subtable2ClassTable(
                    out,
                    &format!("{path}.rightOffsetTable"),
                    &value.right_offset_table,
                )?;
                probes2(out, path, &value, count)?;
            }
            SubtableKind::Format3(value) => {
                writeln!(out, "{path}=Format3")?;
                crate::dump_support::begin_table();
                crate::generated_dump_kern::dump_Subtable3(out, path, &value)?;
                probes3(out, path, &value, count)?;
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
fn probes3(out: &mut impl Write, path: &str, value: &Subtable3<'_>, count: u32) -> io::Result<()> {
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
