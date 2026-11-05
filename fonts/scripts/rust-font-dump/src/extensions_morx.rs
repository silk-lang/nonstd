// Copyright 2022 the Fontations Authors. Licensed under Apache-2.0 or MIT.
use crate::extensions_aat_common::*;
use read_fonts::{tables::morx::*, FontData, FontRef, TableProvider};
use std::io::{self, Write};
pub fn dump(out: &mut impl Write, path: &str, font: &FontRef<'_>) -> io::Result<()> {
    let count = font.selected_maxp().map(|x| x.num_glyphs()).unwrap_or(0);
    let path = &format!("{path}.morxKinds");
    match font.morx() {
        Ok(value) => {
            for (i, chain) in value.chains().iter().enumerate() {
                let path = &format!("{path}[{i}]");
                match chain {
                    Ok(chain) => {
                        for (j, subtable) in chain.subtables().iter().enumerate() {
                            let path = &format!("{path}.subtables[{j}]");
                            match subtable {
                                Ok(subtable) => dump_subtable(out, path, subtable, count)?,
                                Err(error) => {
                                    writeln!(out, "{path}.error={}", crate::error(error))?
                                }
                            }
                        }
                    }
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
    writeln!(out, "{path}.isLogical={}", subtable.is_logical())?;
    writeln!(
        out,
        "{path}.isAllDirections={}",
        subtable.is_all_directions()
    )?;
    writeln!(out, "{path}.isBackwards={}", subtable.is_backwards())?;
    writeln!(out, "{path}.isVertical={}", subtable.is_vertical())?;
    match SubtableKind::parts(data, subtable.coverage()) {
        Ok(parts) => {
            writeln!(out, "{path}.parts.format={}", parts.format)?;
            writeln!(out, "{path}.parts.nClasses={}", parts.state.n_classes)?;
            writeln!(
                out,
                "{path}.parts.classOffset={}",
                parts.state.class_table_offset
            )?;
            writeln!(
                out,
                "{path}.parts.stateOffset={}",
                parts.state.state_array_offset
            )?;
            writeln!(
                out,
                "{path}.parts.entryOffset={}",
                parts.state.entry_table_offset
            )?;
            writeln!(out, "{path}.parts.extra0={}", parts.extra[0])?;
            writeln!(out, "{path}.parts.extra1={}", parts.extra[1])?;
            writeln!(out, "{path}.parts.extra2={}", parts.extra[2])?;
            match SubtableKind::from_parts(data, &parts) {
                Ok(_) => writeln!(out, "{path}.parts.fromParts=ok")?,
                Err(error) => {
                    writeln!(out, "{path}.parts.fromParts.error={}", crate::error(error))?
                }
            }
        }
        Err(error) => writeln!(out, "{path}.parts.error={}", crate::error(error))?,
    }
    let path = &format!("{path}.kind");
    match subtable.kind() {
        Ok(kind) => match kind {
            SubtableKind::Rearrangement(value) => {
                writeln!(out, "{path}=Rearrangement")?;
                dump_extended_state(out, &format!("{path}.state"), &value, data, count)?;
            }
            SubtableKind::Contextual(value) => {
                writeln!(out, "{path}=Contextual")?;
                dump_extended_state(
                    out,
                    &format!("{path}.state"),
                    &value.state_table,
                    data,
                    count,
                )?;
                let offset = data.read_at::<u32>(16).unwrap_or(0) as usize;
                let length = data.len().saturating_sub(offset) / 4;
                for i in 0..length {
                    let path = &format!("{path}.lookups[{i}]");
                    match value.lookup(i) {
                        Some(lookup) => dump_lookup_u16(out, path, &lookup, count)?,
                        None => writeln!(out, "{path}=none")?,
                    }
                }
            }
            SubtableKind::Ligature(value) => {
                writeln!(out, "{path}=Ligature")?;
                dump_extended_state(
                    out,
                    &format!("{path}.state"),
                    &value.state_table,
                    data,
                    count,
                )?;
                dump_array(
                    out,
                    &format!("{path}.ligatureActions"),
                    value.ligature_actions,
                )?;
                dump_array(out, &format!("{path}.components"), value.components)?;
                dump_glyphs(out, &format!("{path}.ligatures"), value.ligatures)?;
            }
            SubtableKind::NonContextual(value) => {
                writeln!(out, "{path}=NonContextual")?;
                dump_lookup_u16(out, path, &value, count)?;
            }
            SubtableKind::Insertion(value) => {
                writeln!(out, "{path}=Insertion")?;
                dump_extended_state(
                    out,
                    &format!("{path}.state"),
                    &value.state_table,
                    data,
                    count,
                )?;
                dump_glyphs(out, &format!("{path}.glyphs"), value.glyphs)?;
            }
        },
        Err(error) => writeln!(out, "{path}.error={}", crate::error(error))?,
    }
    Ok(())
}
