// Copyright 2022 the Fontations Authors. Licensed under Apache-2.0 or MIT.
use crate::generated_dump_bitmap::{
    dump_BdtComponent, dump_BigGlyphMetrics, dump_SmallGlyphMetrics,
};
use read_fonts::{tables::bitmap::*, types::GlyphId, FontData, FontRef, TableProvider};
use std::io::{self, Write};
fn dump_location(
    out: &mut impl Write,
    path: &str,
    location: &BitmapLocation,
    base: FontData<'_>,
) -> io::Result<()> {
    writeln!(out, "{path}.format={}", location.format)?;
    writeln!(out, "{path}.dataOffset={}", location.data_offset)?;
    writeln!(out, "{path}.dataSize={}", location.data_size)?;
    writeln!(out, "{path}.bitDepth={}", location.bit_depth)?;
    let path = &format!("{path}.locationMetrics");
    match &location.metrics {
        Some(value) => dump_BigGlyphMetrics(out, path, value, base),
        None => writeln!(out, "{path}=none"),
    }
}
fn dump_data(
    out: &mut impl Write,
    path: &str,
    data: &BitmapData<'_>,
    base: FontData<'_>,
) -> io::Result<()> {
    let metric_path = &format!("{path}.metrics");
    match &data.metrics {
        BitmapMetrics::Small(value) => {
            writeln!(out, "{metric_path}.kind=Small")?;
            dump_SmallGlyphMetrics(out, metric_path, value, base)?;
        }
        BitmapMetrics::Big(value) => {
            writeln!(out, "{metric_path}.kind=Big")?;
            dump_BigGlyphMetrics(out, metric_path, value, base)?;
        }
    }
    let path = &format!("{path}.content");
    match &data.content {
        BitmapContent::Data(format, data) => {
            writeln!(out, "{path}.kind={format:?}")?;
            write!(out, "{path}.bytes=")?;
            for byte in *data {
                write!(out, "{byte:02x}")?;
            }
            writeln!(out)?;
        }
        BitmapContent::Composite(value) => {
            writeln!(out, "{path}.kind=Composite")?;
            writeln!(out, "{path}.components.length={}", value.len())?;
            for (index, item) in value.iter().enumerate() {
                dump_BdtComponent(out, &format!("{path}.components[{index}]"), item, base)?;
            }
        }
    }
    Ok(())
}

fn dump_cblc(out: &mut impl Write, path: &str, font: &FontRef<'_>) -> io::Result<()> {
    let locations = match font.cblc() {
        Ok(value) => value,
        Err(error) => return writeln!(out, "{path}.error={}", crate::error(error)),
    };
    let images = match font.cbdt() {
        Ok(value) => value,
        Err(error) => return writeln!(out, "{path}.error={}", crate::error(error)),
    };
    let sizes = locations.bitmap_sizes();
    for (index, size) in sizes.iter().enumerate() {
        for gid in size.start_glyph_index().to_u32()..=size.end_glyph_index().to_u32() {
            let path = &format!("{path}.strikes[{index}].glyphs[{gid}]");
            match size.location(locations.offset_data(), GlyphId::new(gid)) {
                Err(error) => writeln!(out, "{path}.error={}", crate::error(error))?,
                Ok(location) => {
                    dump_location(out, path, &location, locations.offset_data())?;
                    match images.data(&location) {
                        Ok(data) => dump_data(out, path, &data, images.offset_data())?,
                        Err(error) => writeln!(out, "{path}.error={}", crate::error(error))?,
                    }
                }
            }
        }
    }
    writeln!(out, "{path}.strikes.length={}", sizes.len())
}

fn dump_eblc(out: &mut impl Write, path: &str, font: &FontRef<'_>) -> io::Result<()> {
    let locations = match font.eblc() {
        Ok(value) => value,
        Err(error) => return writeln!(out, "{path}.error={}", crate::error(error)),
    };
    let images = match font.ebdt() {
        Ok(value) => value,
        Err(error) => return writeln!(out, "{path}.error={}", crate::error(error)),
    };
    let sizes = locations.bitmap_sizes();
    for (index, size) in sizes.iter().enumerate() {
        for gid in size.start_glyph_index().to_u32()..=size.end_glyph_index().to_u32() {
            let path = &format!("{path}.strikes[{index}].glyphs[{gid}]");
            match size.location(locations.offset_data(), GlyphId::new(gid)) {
                Err(error) => writeln!(out, "{path}.error={}", crate::error(error))?,
                Ok(location) => {
                    dump_location(out, path, &location, locations.offset_data())?;
                    match images.data(&location) {
                        Ok(data) => dump_data(out, path, &data, images.offset_data())?,
                        Err(error) => writeln!(out, "{path}.error={}", crate::error(error))?,
                    }
                }
            }
        }
    }
    writeln!(out, "{path}.strikes.length={}", sizes.len())
}
pub fn dump(out: &mut impl Write, path: &str, font: &FontRef<'_>) -> io::Result<()> {
    crate::dump_support::begin_table();
    dump_cblc(out, &format!("{path}.bitmapData.CBLC"), font)?;
    dump_eblc(out, &format!("{path}.bitmapData.EBLC"), font)
}
