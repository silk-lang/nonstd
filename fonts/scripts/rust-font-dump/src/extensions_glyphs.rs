// Copyright 2022 the Fontations Authors. Licensed under Apache-2.0 or MIT.
use read_fonts::{
    tables::{
        glyf::Glyf,
        gvar::{GlyphVariationDataHeader, GlyphVariationDataHeaderExtended, SelectedGvar},
        loca::{Loca, LocaGlyph},
        variations::Tuple,
    },
    types::{F2Dot14, Fixed, GlyphId},
    FontData, FontRead, FontRef, ReadError, TableProvider,
};
use std::io::{self, Write};
pub fn dump(out: &mut impl Write, path: &str, font: &FontRef<'_>) -> io::Result<()> {
    {
        let path = &format!("{path}.glyfLoca");
        match font.loca(None) {
            Ok(value) => dump_loca(out, path, value, font.glyf())?,
            Err(error) => writeln!(out, "{path}.error={}", crate::error(error))?,
        }
    }
    {
        let path = &format!("{path}.GLYFLOCA");
        match font.loca_extended(None) {
            Ok(value) => dump_loca(out, path, value, font.glyf_extended())?,
            Err(error) => writeln!(out, "{path}.error={}", crate::error(error))?,
        }
    }
    {
        let path = &format!("{path}.gvarGlyphs");
        match font.gvar() {
            Ok(value) => dump_gvar(out, path, SelectedGvar::Original(value))?,
            Err(error) => writeln!(out, "{path}.error={}", crate::error(error))?,
        }
    }
    {
        let path = &format!("{path}.GVARGlyphs");
        match font.gvar_extended() {
            Ok(value) => dump_gvar(out, path, SelectedGvar::Extended(value))?,
            Err(error) => writeln!(out, "{path}.error={}", crate::error(error))?,
        }
    }
    Ok(())
}
fn dump_loca(
    out: &mut impl Write,
    path: &str,
    table: Loca<'_>,
    glyf: Result<Glyf<'_>, ReadError>,
) -> io::Result<()> {
    let (kind, count) = match &table {
        Loca::Short(data) => ("Short", data.len()),
        Loca::Long(data) => ("Long", data.len()),
    };
    writeln!(out, "{path}.kind={kind}")?;
    writeln!(out, "{path}.offsets.length={count}")?;
    for index in 0..count {
        match table.get_raw(index) {
            Some(value) => writeln!(out, "{path}.offsets[{index}]={value}")?,
            None => writeln!(out, "{path}.offsets[{index}]=none")?,
        }
    }
    writeln!(
        out,
        "{path}.ascending={}",
        table.all_offsets_are_ascending()
    )?;
    match glyf {
        Err(error) => writeln!(out, "{path}.glyphs.error={}", crate::error(error))?,
        Ok(value) => {
            for glyph in 0..table.len() {
                let path = &format!("{path}.glyphs[{glyph}]");
                crate::dump_support::begin_table();
                match table.get(GlyphId::new(glyph as u32), &value) {
                    None => writeln!(out, "{path}=none")?,
                    Some(LocaGlyph::Empty) => writeln!(out, "{path}=empty")?,
                    Some(LocaGlyph::Glyph(outline)) => {
                        crate::generated_dump_glyf::dump_Glyph(out, path, &outline)?
                    }
                }
            }
        }
    }
    Ok(())
}
fn dump_tuple(out: &mut impl Write, path: &str, tuple: Option<Tuple<'_>>) -> io::Result<()> {
    match tuple {
        Some(value) => {
            crate::generated_dump_variations::dump_Tuple(out, path, &value, FontData::new(&[]))
        }
        None => writeln!(out, "{path}=none"),
    }
}
fn dump_gvar(out: &mut impl Write, path: &str, table: SelectedGvar<'_>) -> io::Result<()> {
    for glyph in 0..table.glyph_count() {
        let path = &format!("{path}[{glyph}]");
        crate::dump_support::begin_table();
        let gid = GlyphId::new(glyph);
        {
            let path = &format!("{path}.raw");
            match table.data_for_gid(gid) {
                Err(error) => writeln!(out, "{path}.error={}", crate::error(error))?,
                Ok(None) => writeln!(out, "{path}=none")?,
                Ok(Some(value)) => match &table {
                    SelectedGvar::Extended(_) => {
                        match GlyphVariationDataHeaderExtended::read(value) {
                            Ok(header) => {
                                crate::generated_dump_gvar::dump_GlyphVariationDataHeaderExtended(
                                    out, path, &header,
                                )?
                            }
                            Err(error) => writeln!(out, "{path}.error={}", crate::error(error))?,
                        }
                    }
                    SelectedGvar::Original(_) => match GlyphVariationDataHeader::read(value) {
                        Ok(header) => crate::generated_dump_gvar::dump_GlyphVariationDataHeader(
                            out, path, &header,
                        )?,
                        Err(error) => writeln!(out, "{path}.error={}", crate::error(error))?,
                    },
                },
            }
        }
        let path = &format!("{path}.tuples");
        match table.glyph_variation_data(gid) {
            Err(error) => writeln!(out, "{path}.error={}", crate::error(error))?,
            Ok(None) => writeln!(out, "{path}=none")?,
            Ok(Some(value)) => {
                let mut length = 0;
                for (index, tuple) in value.tuples().enumerate() {
                    length += 1;
                    let path = &format!("{path}[{index}]");
                    writeln!(
                        out,
                        "{path}.allPoints={}",
                        tuple.has_deltas_for_all_points()
                    )?;
                    dump_tuple(out, &format!("{path}.peak"), Some(tuple.peak()))?;
                    dump_tuple(out, &format!("{path}.start"), tuple.intermediate_start())?;
                    dump_tuple(out, &format!("{path}.end"), tuple.intermediate_end())?;
                    for (index, delta) in tuple.deltas().enumerate() {
                        writeln!(out, "{path}.deltas[{index}].position={}", delta.position)?;
                        writeln!(out, "{path}.deltas[{index}].x={}", delta.x_delta)?;
                        writeln!(out, "{path}.deltas[{index}].y={}", delta.y_delta)?;
                    }
                    for (location, coordinate) in [0, -8192, 8192, 16384].into_iter().enumerate() {
                        let path = &format!("{path}.evaluated[{location}]");
                        let coords =
                            vec![F2Dot14::from_bits(coordinate); usize::from(table.axis_count())];
                        match tuple.compute_scalar(&coords) {
                            None => writeln!(out, "{path}=none")?,
                            Some(scale) => {
                                writeln!(out, "{path}.scalar={}", scale.to_bits())?;
                                for (index, delta) in tuple.deltas().enumerate() {
                                    let point = delta.apply_scalar::<Fixed>(scale);
                                    writeln!(
                                        out,
                                        "{path}.deltas[{index}].x={}",
                                        point.x.to_bits()
                                    )?;
                                    writeln!(
                                        out,
                                        "{path}.deltas[{index}].y={}",
                                        point.y.to_bits()
                                    )?;
                                }
                            }
                        }
                    }
                }
                writeln!(out, "{path}.length={length}")?;
            }
        }
    }
    Ok(())
}
