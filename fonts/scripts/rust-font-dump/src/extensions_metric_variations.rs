// Copyright 2022 the Fontations Authors. Licensed under Apache-2.0 or MIT.
use read_fonts::{
    tables::{hvar::Hvar, mvar::Mvar, vvar::Vvar},
    types::{F2Dot14, GlyphId},
    FontRef, TableProvider,
};
use std::io::{self, Write};
pub fn dump(out: &mut impl Write, path: &str, font: &FontRef<'_>) -> io::Result<()> {
    let count = font.selected_maxp().map(|x| x.num_glyphs()).unwrap_or(0);
    {
        let path = &format!("{path}.HVARMetrics");
        match font.hvar() {
            Ok(value) => dump_hvar(out, path, value, count)?,
            Err(error) => writeln!(out, "{path}.error={}", crate::error(error))?,
        }
    }
    {
        let path = &format!("{path}.VVARMetrics");
        match font.vvar() {
            Ok(value) => dump_vvar(out, path, value, count)?,
            Err(error) => writeln!(out, "{path}.error={}", crate::error(error))?,
        }
    }
    {
        let path = &format!("{path}.MVARMetrics");
        match font.mvar() {
            Ok(value) => dump_mvar(out, path, value, count)?,
            Err(error) => writeln!(out, "{path}.error={}", crate::error(error))?,
        }
    }
    Ok(())
}
fn dump_hvar(out: &mut impl Write, path: &str, table: Hvar<'_>, count: u32) -> io::Result<()> {
    let axis_count = table
        .item_variation_store()
        .ok()
        .and_then(|x| x.variation_region_list().ok())
        .map(|x| usize::from(x.axis_count()))
        .unwrap_or(0);
    for (location, coordinate) in [0, -8192, 8192, 16384].into_iter().enumerate() {
        let path = &format!("{path}[{location}]");
        let coords = vec![F2Dot14::from_bits(coordinate); axis_count];
        for glyph in 0..=count {
            let path = &format!("{path}.glyphs[{glyph}]");
            let gid = GlyphId::new(glyph);
            match table.advance_delta(gid, &coords) {
                Some(value) => writeln!(out, "{path}.advanceDelta={}", value.to_bits())?,
                None => writeln!(out, "{path}.advanceDelta=none")?,
            }
            match table.lsb_delta(gid, &coords) {
                Some(value) => writeln!(out, "{path}.lsbDelta={}", value.to_bits())?,
                None => writeln!(out, "{path}.lsbDelta=none")?,
            }
            match table.rsb_delta(gid, &coords) {
                Some(value) => writeln!(out, "{path}.rsbDelta={}", value.to_bits())?,
                None => writeln!(out, "{path}.rsbDelta=none")?,
            }
        }
    }
    Ok(())
}
fn dump_vvar(out: &mut impl Write, path: &str, table: Vvar<'_>, count: u32) -> io::Result<()> {
    let axis_count = table
        .item_variation_store()
        .ok()
        .and_then(|x| x.variation_region_list().ok())
        .map(|x| usize::from(x.axis_count()))
        .unwrap_or(0);
    for (location, coordinate) in [0, -8192, 8192, 16384].into_iter().enumerate() {
        let path = &format!("{path}[{location}]");
        let coords = vec![F2Dot14::from_bits(coordinate); axis_count];
        for glyph in 0..=count {
            let path = &format!("{path}.glyphs[{glyph}]");
            let gid = GlyphId::new(glyph);
            match table.advance_delta(gid, &coords) {
                Some(value) => writeln!(out, "{path}.advanceDelta={}", value.to_bits())?,
                None => writeln!(out, "{path}.advanceDelta=none")?,
            }
            match table.tsb_delta(gid, &coords) {
                Some(value) => writeln!(out, "{path}.tsbDelta={}", value.to_bits())?,
                None => writeln!(out, "{path}.tsbDelta=none")?,
            }
            match table.bsb_delta(gid, &coords) {
                Some(value) => writeln!(out, "{path}.bsbDelta={}", value.to_bits())?,
                None => writeln!(out, "{path}.bsbDelta=none")?,
            }
            match table.v_origin_y_delta(gid, &coords) {
                Some(value) => writeln!(out, "{path}.vOriginYDelta={}", value.to_bits())?,
                None => writeln!(out, "{path}.vOriginYDelta=none")?,
            }
        }
    }
    Ok(())
}
fn dump_mvar(out: &mut impl Write, path: &str, table: Mvar<'_>, _count: u32) -> io::Result<()> {
    let axis_count = table
        .item_variation_store()
        .and_then(Result::ok)
        .and_then(|x| x.variation_region_list().ok())
        .map(|x| usize::from(x.axis_count()))
        .unwrap_or(0);
    for (location, coordinate) in [0, -8192, 8192, 16384].into_iter().enumerate() {
        let path = &format!("{path}[{location}]");
        let coords = vec![F2Dot14::from_bits(coordinate); axis_count];
        for (index, record) in table.value_records().iter().enumerate() {
            let path = &format!("{path}.records[{index}]");
            match table.metric_delta(record.value_tag(), &coords) {
                Some(delta) => writeln!(out, "{path}={}", delta.to_bits())?,
                None => writeln!(out, "{path}=none")?,
            }
        }
    }
    Ok(())
}
