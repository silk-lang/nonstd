// Copyright 2022 the Fontations Authors. Licensed under Apache-2.0 or MIT.
use read_fonts::{
    tables::trak::TrackData, types::GlyphId, FontData, FontRef, ReadError, TableProvider,
};
use std::io::{self, Write};
pub fn dump(out: &mut impl Write, path: &str, font: &FontRef<'_>) -> io::Result<()> {
    let count = font
        .selected_maxp()
        .map(|x| x.num_glyphs())
        .unwrap_or(0)
        .min(65536);
    let child = &format!("{path}.trakValues");
    match font.trak() {
        Ok(value) => {
            track(
                out,
                &format!("{child}.horizontal"),
                value.horiz(),
                value.offset_data(),
            )?;
            track(
                out,
                &format!("{child}.vertical"),
                value.vert(),
                value.offset_data(),
            )?;
        }
        Err(error) => writeln!(out, "{child}.error={}", crate::error(error))?,
    }
    let child = &format!("{path}.ankrPoints");
    match font.ankr() {
        Ok(value) => {
            for gid in 0..=count {
                let path = &format!("{child}[{gid}]");
                match value.anchor_points(GlyphId::new(gid)) {
                    Ok(points) => {
                        writeln!(out, "{path}.length={}", points.len())?;
                        for (i, point) in points.iter().enumerate() {
                            writeln!(out, "{path}.points[{i}].x={}", point.x())?;
                            writeln!(out, "{path}.points[{i}].y={}", point.y())?;
                        }
                    }
                    Err(error) => writeln!(out, "{path}.error={}", crate::error(error))?,
                }
            }
        }
        Err(error) => writeln!(out, "{child}.error={}", crate::error(error))?,
    }
    let child = &format!("{path}.featSettings");
    match font.feat() {
        Ok(value) => {
            for (i, feature) in value.names().iter().enumerate() {
                let path = &format!("{child}[{i}]");
                writeln!(out, "{path}.exclusive={}", feature.is_exclusive())?;
                writeln!(
                    out,
                    "{path}.defaultIndex={}",
                    feature.default_setting_index()
                )?;
                match value.find(feature.feature()) {
                    Some(found) => {
                        writeln!(out, "{path}.findName={}", found.name_index().to_u16())?
                    }
                    None => writeln!(out, "{path}.findName=none")?,
                }
            }
        }
        Err(error) => writeln!(out, "{child}.error={}", crate::error(error))?,
    }
    let child = &format!("{path}.ltagStrings");
    match font.ltag() {
        Ok(value) => {
            for (index, tag) in value.tag_indices() {
                write!(out, "{child}[{index}].utf8=")?;
                for byte in tag.as_bytes() {
                    write!(out, "{byte:02x}")?;
                }
                writeln!(out)?;
                match value.index_for_tag(tag) {
                    Some(found) => writeln!(out, "{child}[{index}].findIndex={found}")?,
                    None => writeln!(out, "{child}[{index}].findIndex=none")?,
                }
            }
        }
        Err(error) => writeln!(out, "{child}.error={}", crate::error(error))?,
    }
    Ok(())
}
fn track(
    out: &mut impl Write,
    path: &str,
    data: Option<Result<TrackData<'_>, ReadError>>,
    base: FontData<'_>,
) -> io::Result<()> {
    let data = match data {
        Some(Ok(value)) => value,
        Some(Err(error)) => return writeln!(out, "{path}.error={}", crate::error(error)),
        None => return writeln!(out, "{path}=none"),
    };
    match data.size_table(base) {
        Some(sizes) => {
            writeln!(out, "{path}.sizes.length={}", sizes.len())?;
            for (i, value) in sizes.iter().enumerate() {
                writeln!(out, "{path}.sizes[{i}]={}", value.get().to_bits())?;
            }
        }
        None => writeln!(out, "{path}.sizes=none")?,
    }
    for (i, entry) in data.track_table().iter().enumerate() {
        match entry.per_size_values(base, data.n_sizes()) {
            Some(values) => crate::extensions_aat_common::dump_array(
                out,
                &format!("{path}.tracks[{i}].values"),
                values,
            )?,
            None => writeln!(out, "{path}.tracks[{i}].values=none")?,
        }
    }
    Ok(())
}
