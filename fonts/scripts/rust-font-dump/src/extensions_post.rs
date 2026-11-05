use read_fonts::{tables::post::Post, types::GlyphId16};
use std::io::{self, Write};
fn bytes(out: &mut impl Write, path: &str, bytes: &[u8]) -> io::Result<()> {
    write!(out, "{path}=")?;
    for byte in bytes {
        write!(out, "{byte:02x}")?;
    }
    writeln!(out)
}
pub fn dump(out: &mut impl Write, path: &str, table: &Post<'_>) -> io::Result<()> {
    let count = table.num_names();
    writeln!(out, "{path}.numNames={count}")?;
    let mut length = 0;
    for (i, (gid, name)) in table.glyph_names().enumerate() {
        writeln!(out, "{path}.glyphNames[{i}].glyph={}", gid.to_u32())?;
        bytes(
            out,
            &format!("{path}.glyphNames[{i}].name"),
            name.as_bytes(),
        )?;
        length += 1;
    }
    writeln!(out, "{path}.glyphNames.length={length}")?;
    for (i, gid) in [0, 1, 2, count / 4, count / 2, count, 65534, 65535]
        .into_iter()
        .enumerate()
    {
        let path = format!("{path}.nameProbes[{i}]");
        match table.glyph_name(GlyphId16::new(gid as u16)) {
            Some(name) => bytes(out, &path, name.as_bytes())?,
            None => writeln!(out, "{path}=none")?,
        }
    }
    Ok(())
}
