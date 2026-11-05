use read_fonts::{
    tables::cmap::{Cmap, CmapIterLimits, CmapSubtable, MapVariant, UvsSubtable},
    types::GlyphId,
};
use std::io::{self, Write};
fn mapped(value: Option<GlyphId>) -> i64 {
    value.map(|g| g.to_u32() as i64).unwrap_or(-1)
}
fn variant(value: Option<MapVariant>) -> i64 {
    match value {
        None => -1,
        Some(MapVariant::UseDefault) => -2,
        Some(MapVariant::Variant(g)) => g.to_u32() as i64,
    }
}
pub fn dump(out: &mut impl Write, path: &str, table: &Cmap<'_>) -> io::Result<()> {
    match table.best_subtable() {
        None => writeln!(out, "{path}.bestSubtable=none")?,
        Some((index, record, _)) => {
            writeln!(out, "{path}.bestSubtable.index={index}")?;
            writeln!(out, "{path}.bestSubtable.isSymbol={}", record.is_symbol())?;
            writeln!(
                out,
                "{path}.bestSubtable.isMacRoman={}",
                record.is_mac_roman()
            )?;
        }
    }
    match table.uvs_subtable() {
        None => writeln!(out, "{path}.uvsSubtable=none")?,
        Some((index, table)) => {
            writeln!(out, "{path}.uvsSubtable.index={index}")?;
            writeln!(out, "{path}.uvsSubtable.format={}", table.format())?;
        }
    }
    for (i, cp) in [
        0u32,
        1,
        14,
        32,
        65,
        66,
        96,
        192,
        255,
        256,
        65535,
        65536,
        1114111,
        1114112,
        u32::MAX,
    ]
    .into_iter()
    .enumerate()
    {
        writeln!(
            out,
            "{path}.mapProbes[{i}]={}",
            mapped(table.map_codepoint(cp))
        )?;
    }
    Ok(())
}
pub fn subtable(out: &mut impl Write, path: &str, table: &CmapSubtable<'_>) -> io::Result<()> {
    writeln!(out, "{path}.mappingLanguage={}", table.language())?;
    let mut count = 0;
    for (i, (cp, gid)) in table
        .iter_with_limits(CmapIterLimits::default())
        .enumerate()
    {
        writeln!(
            out,
            "{path}.mappings[{i}]={cp},{},{}",
            gid.to_u32(),
            mapped(table.map_codepoint(cp))
        )?;
        count += 1;
    }
    writeln!(out, "{path}.mappings.length={count}")?;
    match table {
        CmapSubtable::Format14(value) => uvs(out, path, &value.clone().into())?,
        CmapSubtable::Format15(value) => uvs(out, path, &value.clone().into())?,
        _ => (),
    }
    Ok(())
}
fn uvs(out: &mut impl Write, path: &str, table: &UvsSubtable<'_>) -> io::Result<()> {
    let mut count = 0;
    for (i, (cp, selector, mapping)) in table
        .iter_with_limits(CmapIterLimits::default())
        .enumerate()
    {
        writeln!(
            out,
            "{path}.variants[{i}]={cp},{selector},{},{}",
            variant(Some(mapping)),
            variant(table.map_variant(cp, selector))
        )?;
        count += 1;
    }
    writeln!(out, "{path}.variants.length={count}")
}
