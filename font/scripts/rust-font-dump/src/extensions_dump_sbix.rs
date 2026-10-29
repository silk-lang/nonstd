// Copyright 2022 the Fontations Authors. Licensed under Apache-2.0 or MIT.
pub fn dump_strike_glyphs(out: &mut impl Write, path: &str, value: &Strike<'_>) -> io::Result<()> {
    let length = value.glyph_data_offsets().len().saturating_sub(1);
    for index in 0..length {
        crate::dump_support::begin_table();
        let path = &format!("{path}.glyphData[{index}]");
        match value.glyph_data(GlyphId::new(index as u32)) {
            Ok(Some(table)) => dump_GlyphData(out, path, &table)?,
            Ok(None) => writeln!(out, "{path}=none")?,
            Err(error) => writeln!(out, "{path}.error={}", crate::error(error))?,
        }
    }
    writeln!(out, "{path}.glyphData.length={length}")
}
