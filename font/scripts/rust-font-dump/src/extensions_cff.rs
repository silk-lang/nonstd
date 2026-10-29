// Copyright 2022 the Fontations Authors. Licensed under Apache-2.0 or MIT.
use read_fonts::{
    model::Error,
    ps::{
        cff::{
            charset::CharsetKind, index::Index, v1::CffHeader, v2::Cff2Header, CffFontRef, Subfont,
        },
        Blues, HintingParams, ScaledFontMatrix,
    },
    tables::{cff::Cff, cff2::Cff2},
    types::{BoundingBox, F2Dot14, Fixed, GlyphId, Tag},
    FontRead, FontRef, TableProvider,
};
use std::io::{self, Write};
fn scalar(out: &mut impl Write, path: &str, value: impl std::fmt::Display) -> io::Result<()> {
    writeln!(out, "{path}={value}")
}
fn optional<T: std::fmt::Display>(
    out: &mut impl Write,
    path: &str,
    value: Option<T>,
) -> io::Result<()> {
    match value {
        Some(v) => scalar(out, path, v),
        None => scalar(out, path, "none"),
    }
}
fn bytes(out: &mut impl Write, path: &str, value: Option<&[u8]>) -> io::Result<()> {
    write!(out, "{path}=")?;
    match value {
        Some(v) => {
            for byte in v {
                write!(out, "{byte:02x}")?;
            }
            writeln!(out)
        }
        None => writeln!(out, "none"),
    }
}
fn error(out: &mut impl Write, path: &str, error: Error) -> io::Result<()> {
    writeln!(out, "{path}.error={error:?}")
}
fn matrix(out: &mut impl Write, path: &str, value: Option<&ScaledFontMatrix>) -> io::Result<()> {
    let Some(v) = value else {
        return scalar(out, path, "none");
    };
    scalar(out, &format!("{path}.scale"), v.scale)?;
    for (i, n) in v.matrix.elements().into_iter().enumerate() {
        scalar(out, &format!("{path}.elements[{i}]"), n.to_bits())?;
    }
    Ok(())
}
fn bbox(out: &mut impl Write, path: &str, value: Option<BoundingBox<Fixed>>) -> io::Result<()> {
    let Some(v) = value else {
        return scalar(out, path, "none");
    };
    for (name, n) in [
        ("xMin", v.x_min),
        ("yMin", v.y_min),
        ("xMax", v.x_max),
        ("yMax", v.y_max),
    ] {
        scalar(out, &format!("{path}.{name}"), n.to_bits())?;
    }
    Ok(())
}
fn index(out: &mut impl Write, path: &str, value: &Index<'_>) -> io::Result<()> {
    crate::dump_support::begin_table();
    match value {
        Index::Empty => scalar(out, &format!("{path}.raw"), "empty")?,
        Index::Format1(v) => crate::generated_dump_cff::dump_Index(out, &format!("{path}.raw"), v)?,
        Index::Format2(v) => {
            crate::generated_dump_cff2::dump_Index(out, &format!("{path}.raw"), v)?
        }
    }
    scalar(out, &format!("{path}.count"), value.count())?;
    scalar(out, &format!("{path}.subrBias"), value.subr_bias())?;
    optional(out, &format!("{path}.sizeInBytes"), value.size_in_bytes())?;
    let count = value.count().min(65536);
    scalar(out, &format!("{path}.probeCount"), count)?;
    for i in 0..=count as usize {
        optional(out, &format!("{path}.offsets[{i}]"), value.get_offset(i))?;
        bytes(out, &format!("{path}.objects[{i}]"), value.get(i))?;
    }
    Ok(())
}
pub fn dump(out: &mut impl Write, path: &str, font: &FontRef<'_>) -> io::Result<()> {
    let upem = font.head().ok().map(|h| i32::from(h.units_per_em()));
    for (tag, v2) in [(Tag::new(b"CFF "), false), (Tag::new(b"CFF2"), true)] {
        let path = &format!("{path}.{}", if v2 { "CFF2" } else { "CFF" });
        crate::dump_support::begin_table();
        let Some(data) = font.table_data(tag) else {
            writeln!(
                out,
                "{path}.error={}",
                crate::error(read_fonts::ReadError::TableIsMissing(tag))
            )?;
            continue;
        };
        let header = &format!("{path}.header");
        if v2 {
            match Cff2Header::read(data) {
                Ok(h) => crate::generated_dump_cff2::dump_Cff2Header(out, header, &h)?,
                Err(e) => writeln!(out, "{header}.error={}", crate::error(e))?,
            }
        } else {
            match CffHeader::read(data) {
                Ok(h) => crate::generated_dump_cff::dump_CffHeader(out, header, &h)?,
                Err(e) => writeln!(out, "{header}.error={}", crate::error(e))?,
            }
        }
        let count = if v2 {
            match Cff2::read(data) {
                Ok(cff) => {
                    bytes(out, &format!("{path}.topDict"), Some(cff.top_dict_data()))?;
                    index(
                        out,
                        &format!("{path}.globalSubrs"),
                        &cff.global_subrs().into(),
                    )?;
                    1
                }
                Err(e) => {
                    writeln!(out, "{path}.container.error={}", crate::error(e))?;
                    continue;
                }
            }
        } else {
            match Cff::read(data) {
                Ok(cff) => {
                    index(out, &format!("{path}.names"), &cff.names().into())?;
                    index(out, &format!("{path}.topDicts"), &cff.top_dicts().into())?;
                    index(out, &format!("{path}.strings"), &cff.strings().into())?;
                    index(
                        out,
                        &format!("{path}.globalSubrs"),
                        &cff.global_subrs().into(),
                    )?;
                    u32::from(cff.top_dicts().count())
                }
                Err(e) => {
                    writeln!(out, "{path}.container.error={}", crate::error(e))?;
                    continue;
                }
            }
        };
        for i in 0..count {
            let child = &format!("{path}.fonts[{i}]");
            let dict_path = &format!("{child}.dictionary");
            let dict = if v2 {
                Cff2::read(data).ok().map(|v| v.top_dict_data())
            } else {
                Cff::read(data)
                    .ok()
                    .and_then(|v| v.top_dicts().get(i as usize))
            };
            if let Some(dict) = dict {
                dictionary(out, dict_path, data, dict, v2, 0, 0)?;
            } else {
                scalar(out, dict_path, "none")?;
            }
            match CffFontRef::new(data.as_bytes(), i, upem) {
                Ok(cff) => font_values(out, child, &cff)?,
                Err(e) => error(out, child, e)?,
            }
        }
    }
    Ok(())
}
fn font_values(out: &mut impl Write, path: &str, font: &CffFontRef<'_>) -> io::Result<()> {
    scalar(out, &format!("{path}.version"), font.version())?;
    scalar(out, &format!("{path}.isCid"), font.is_cid())?;
    scalar(out, &format!("{path}.upem"), font.upem())?;
    scalar(out, &format!("{path}.numGlyphs"), font.num_glyphs())?;
    scalar(out, &format!("{path}.numSubfonts"), font.num_subfonts())?;
    matrix(out, &format!("{path}.matrix"), font.matrix())?;
    let meta_path = &format!("{path}.metadata");
    if let Some(m) = font.metadata() {
        for (name, value) in [
            ("name", m.name()),
            ("version", m.version()),
            ("notice", m.notice()),
            ("copyright", m.copyright()),
            ("fullName", m.full_name()),
            ("familyName", m.family_name()),
            ("weight", m.weight()),
        ] {
            bytes(
                out,
                &format!("{meta_path}.{name}"),
                value.map(str::as_bytes),
            )?;
        }
        bbox(out, &format!("{meta_path}.bbox"), Some(m.bbox()))?;
        scalar(
            out,
            &format!("{meta_path}.italicAngle"),
            m.italic_angle().to_bits(),
        )?;
        scalar(
            out,
            &format!("{meta_path}.isFixedPitch"),
            m.is_fixed_pitch(),
        )?;
        scalar(
            out,
            &format!("{meta_path}.underlinePosition"),
            m.underline_position().to_bits(),
        )?;
        scalar(
            out,
            &format!("{meta_path}.underlineThickness"),
            m.underline_thickness().to_bits(),
        )?;
    } else {
        scalar(out, meta_path, "none")?;
    }
    index(out, &format!("{path}.charstrings"), font.charstrings())?;
    let count = font.num_glyphs().min(65536);
    scalar(out, &format!("{path}.glyphProbeCount"), count)?;
    let charset = font.charset();
    if let Some(chars) = &charset {
        let (kind, custom) = match chars.kind() {
            CharsetKind::IsoAdobe => ("IsoAdobe", None),
            CharsetKind::Expert => ("Expert", None),
            CharsetKind::ExpertSubset => ("ExpertSubset", None),
            CharsetKind::Custom(v) => ("Custom", Some(v)),
        };
        scalar(out, &format!("{path}.charset.kind"), kind)?;
        if let Some(custom) = custom {
            crate::dump_support::begin_table();
            crate::generated_dump_cff::dump_CustomCharset(
                out,
                &format!("{path}.charset.raw"),
                custom,
            )?;
        }
    } else {
        scalar(out, &format!("{path}.charset"), "none")?;
    }
    for gid in 0..=count {
        let child = &format!("{path}.names[{gid}]");
        let sid = charset
            .as_ref()
            .and_then(|c| c.string_id(GlyphId::new(gid)));
        optional(out, &format!("{child}.sid"), sid.map(|s| s.to_u16()))?;
        bytes(
            out,
            &format!("{child}.name"),
            sid.and_then(|s| font.string(s)),
        )?;
        optional(
            out,
            &format!("{child}.reverseGlyph"),
            sid.and_then(|s| charset.as_ref()?.glyph_id(s))
                .map(|g| g.to_u32()),
        )?;
    }
    if let Some(enc) = font.encoding() {
        optional(
            out,
            &format!("{path}.encoding.predefined"),
            enc.predefined().map(|p| format!("{p:?}")),
        )?;
        for code in 0..=255 {
            optional(
                out,
                &format!("{path}.encoding.codes[{code}]"),
                enc.map(code).map(|g| g.to_u32()),
            )?;
        }
    } else {
        scalar(out, &format!("{path}.encoding"), "none")?;
    }
    let mut axes = 0;
    if let Some(store) = font.var_store() {
        axes = store
            .variation_region_list()
            .map(|r| r.axis_count())
            .unwrap_or(0);
        crate::dump_support::begin_table();
        crate::generated_dump_variations::dump_ItemVariationStore(
            out,
            &format!("{path}.varStore"),
            store,
        )?;
    } else {
        scalar(out, &format!("{path}.varStore"), "none")?;
    }
    for (location, coord) in [0, -8192, 8192, 16384].into_iter().enumerate() {
        let coords = vec![F2Dot14::from_bits(coord); axes as usize];
        let path = &format!("{path}.locations[{location}]");
        scalar(out, &format!("{path}.coord"), coord)?;
        for i in 0..=u32::from(font.num_subfonts()) {
            let child = &format!("{path}.subfonts[{i}]");
            match font.subfont(i as u16, &coords) {
                Ok(sub) => subfont(out, child, &sub)?,
                Err(e) => error(out, child, e)?,
            };
            match font.subfont_hinted(i as u16, &coords) {
                Ok((sub, hints)) => {
                    subfont(out, &format!("{child}.hinted"), &sub)?;
                    hinting(out, &format!("{child}.hints"), &hints)?;
                }
                Err(e) => error(out, &format!("{child}.hinted"), e)?,
            }
        }
        for gid in 0..=count {
            let child = &format!("{path}.glyphs[{gid}]");
            let glyph = GlyphId::new(gid);
            let selected = font.subfont_index(glyph);
            optional(out, &format!("{child}.subfont"), selected)?;
            let Some(selected) = selected else { continue };
            let sub = match font.subfont(selected, &coords) {
                Ok(sub) => sub,
                Err(e) => {
                    error(out, child, e)?;
                    continue;
                }
            };
            match font.evaluate_width(&sub, glyph, &coords) {
                Ok(width) => optional(out, &format!("{child}.width"), width.map(|w| w.to_bits()))?,
                Err(e) => error(out, &format!("{child}.width"), e)?,
            }
            match font.evaluate_extents(&sub, glyph, &coords) {
                Ok(bounds) => bbox(out, &format!("{child}.bounds"), bounds)?,
                Err(e) => error(out, &format!("{child}.bounds"), e)?,
            }
        }
    }
    Ok(())
}
fn subfont(out: &mut impl Write, path: &str, sub: &Subfont) -> io::Result<()> {
    scalar(out, &format!("{path}.subrsOffset"), sub.subrs_offset())?;
    optional(
        out,
        &format!("{path}.defaultWidth"),
        sub.default_width().map(|w| w.to_bits()),
    )?;
    scalar(
        out,
        &format!("{path}.nominalWidth"),
        sub.nominal_width().to_bits(),
    )?;
    scalar(out, &format!("{path}.vsIndex"), sub.vs_index())?;
    matrix(out, &format!("{path}.matrix"), sub.matrix())
}
fn blues(out: &mut impl Write, path: &str, blues: &Blues) -> io::Result<()> {
    scalar(out, &format!("{path}.length"), blues.values().len())?;
    for (i, (a, b)) in blues.values().iter().enumerate() {
        scalar(out, &format!("{path}[{i}].first"), a.to_bits())?;
        scalar(out, &format!("{path}[{i}].second"), b.to_bits())?;
    }
    Ok(())
}
fn hinting(out: &mut impl Write, path: &str, h: &HintingParams) -> io::Result<()> {
    for (name, value) in [
        ("blues", &h.blues),
        ("familyBlues", &h.family_blues),
        ("otherBlues", &h.other_blues),
        ("familyOtherBlues", &h.family_other_blues),
    ] {
        blues(out, &format!("{path}.{name}"), value)?;
    }
    scalar(out, &format!("{path}.blueScale"), h.blue_scale.to_bits())?;
    scalar(out, &format!("{path}.blueShift"), h.blue_shift.to_bits())?;
    scalar(out, &format!("{path}.blueFuzz"), h.blue_fuzz.to_bits())?;
    scalar(out, &format!("{path}.languageGroup"), h.language_group)
}

// Follow only the CFF hierarchy: top -> font -> private -> local subroutine INDEX.
// DICT operands are also observed without blending; location-specific results are above.
#[allow(clippy::too_many_arguments)]
fn dictionary(
    out: &mut impl Write,
    path: &str,
    data: read_fonts::FontData<'_>,
    dict: &[u8],
    v2: bool,
    level: u8,
    base: usize,
) -> io::Result<()> {
    use read_fonts::ps::cff::dict::{entries, Entry};
    for (i, entry) in entries(dict, None).enumerate() {
        let child = &format!("{path}.entries[{i}]");
        let entry = match entry {
            Ok(v) => v,
            Err(e) => {
                error(out, child, e)?;
                continue;
            }
        };
        dictionary_entry(out, child, &entry)?;
        let resolved = &format!("{child}.resolved");
        match entry {
            Entry::PrivateDictRange(range) if level < 2 => match data.as_bytes().get(range.clone())
            {
                Some(bytes) => dictionary(out, resolved, data, bytes, v2, 2, range.start)?,
                None => error(out, resolved, Error::Malformed)?,
            },
            Entry::FdArrayOffset(offset) if level == 0 => {
                match data
                    .as_bytes()
                    .get(offset..)
                    .ok_or(Error::Malformed)
                    .and_then(|b| Index::new(b, v2))
                {
                    Ok(ix) => {
                        index(out, resolved, &ix)?;
                        for n in 0..ix.count().min(65536) as usize {
                            let child = &format!("{resolved}.dictionaries[{n}]");
                            match ix.get(n) {
                                Some(bytes) => dictionary(out, child, data, bytes, v2, 1, 0)?,
                                None => scalar(out, child, "none")?,
                            }
                        }
                    }
                    Err(e) => error(out, resolved, e)?,
                }
            }
            Entry::FdSelectOffset(offset) if level == 0 => {
                crate::dump_support::begin_table();
                match data
                    .split_off(offset)
                    .ok_or(read_fonts::ReadError::OutOfBounds)
                    .and_then(read_fonts::ps::cff::v1::FdSelect::read)
                {
                    Ok(value) => crate::generated_dump_cff::dump_FdSelect(out, resolved, &value)?,
                    Err(e) => writeln!(out, "{resolved}.error={}", crate::error(e))?,
                }
            }
            Entry::SubrsOffset(offset) if level == 2 => {
                match base
                    .checked_add(offset)
                    .and_then(|o| data.as_bytes().get(o..))
                    .ok_or(Error::Malformed)
                    .and_then(|b| Index::new(b, v2))
                {
                    Ok(value) => index(out, resolved, &value)?,
                    Err(e) => error(out, resolved, e)?,
                }
            }
            Entry::Encoding(offset) if level == 0 && offset > 1 => {
                custom_encoding(out, resolved, data, offset)?
            }
            _ => {}
        }
    }
    Ok(())
}
fn custom_encoding(
    out: &mut impl Write,
    path: &str,
    data: read_fonts::FontData<'_>,
    offset: usize,
) -> io::Result<()> {
    use read_fonts::ps::cff::encoding::CustomEncoding;
    let encoding = data.as_bytes().get(offset..).and_then(CustomEncoding::new);
    let supplements = match encoding {
        None => return scalar(out, path, "none"),
        Some(CustomEncoding::Format0(codes, supplements)) => {
            scalar(out, &format!("{path}.format"), 0)?;
            bytes(out, &format!("{path}.codes"), Some(codes))?;
            supplements
        }
        Some(CustomEncoding::Format1(ranges, supplements)) => {
            scalar(out, &format!("{path}.format"), 1)?;
            scalar(out, &format!("{path}.ranges.length"), ranges.len())?;
            for (i, r) in ranges.iter().enumerate() {
                crate::generated_dump_cff::dump_EncodingRange1(
                    out,
                    &format!("{path}.ranges[{i}]"),
                    r,
                    data,
                )?;
            }
            supplements
        }
    };
    scalar(
        out,
        &format!("{path}.supplements.length"),
        supplements.len(),
    )?;
    for (i, s) in supplements.iter().enumerate() {
        crate::generated_dump_cff::dump_EncodingSupplement(
            out,
            &format!("{path}.supplements[{i}]"),
            s,
            data,
        )?;
    }
    Ok(())
}
fn dictionary_entry(
    out: &mut impl Write,
    path: &str,
    entry: &read_fonts::ps::cff::dict::Entry,
) -> io::Result<()> {
    use read_fonts::ps::cff::dict::Entry;
    match entry {
        Entry::Version(value) => {
            scalar(out, &format!("{path}.kind"), "Version")?;
            scalar(out, &format!("{path}.value"), value.to_u16())?;
        }
        Entry::Notice(value) => {
            scalar(out, &format!("{path}.kind"), "Notice")?;
            scalar(out, &format!("{path}.value"), value.to_u16())?;
        }
        Entry::FullName(value) => {
            scalar(out, &format!("{path}.kind"), "FullName")?;
            scalar(out, &format!("{path}.value"), value.to_u16())?;
        }
        Entry::FamilyName(value) => {
            scalar(out, &format!("{path}.kind"), "FamilyName")?;
            scalar(out, &format!("{path}.value"), value.to_u16())?;
        }
        Entry::Weight(value) => {
            scalar(out, &format!("{path}.kind"), "Weight")?;
            scalar(out, &format!("{path}.value"), value.to_u16())?;
        }
        Entry::FontBbox(value) => {
            scalar(out, &format!("{path}.kind"), "FontBbox")?;
            let values = value;
            scalar(out, &format!("{path}.value.length"), values.len())?;
            for (i, v) in values.iter().enumerate() {
                scalar(out, &format!("{path}.value[{i}]"), v.to_bits())?;
            }
        }
        Entry::CharstringsOffset(value) => {
            scalar(out, &format!("{path}.kind"), "CharstringsOffset")?;
            scalar(out, &format!("{path}.value"), value)?;
        }
        Entry::PrivateDictRange(value) => {
            scalar(out, &format!("{path}.kind"), "PrivateDictRange")?;
            scalar(out, &format!("{path}.start"), value.start)?;
            scalar(out, &format!("{path}.end"), value.end)?;
        }
        Entry::VariationStoreOffset(value) => {
            scalar(out, &format!("{path}.kind"), "VariationStoreOffset")?;
            scalar(out, &format!("{path}.value"), value)?;
        }
        Entry::Copyright(value) => {
            scalar(out, &format!("{path}.kind"), "Copyright")?;
            scalar(out, &format!("{path}.value"), value.to_u16())?;
        }
        Entry::IsFixedPitch(value) => {
            scalar(out, &format!("{path}.kind"), "IsFixedPitch")?;
            scalar(out, &format!("{path}.value"), value)?;
        }
        Entry::ItalicAngle(value) => {
            scalar(out, &format!("{path}.kind"), "ItalicAngle")?;
            scalar(out, &format!("{path}.value"), value.to_bits())?;
        }
        Entry::UnderlinePosition(value) => {
            scalar(out, &format!("{path}.kind"), "UnderlinePosition")?;
            scalar(out, &format!("{path}.value"), value.to_bits())?;
        }
        Entry::UnderlineThickness(value) => {
            scalar(out, &format!("{path}.kind"), "UnderlineThickness")?;
            scalar(out, &format!("{path}.value"), value.to_bits())?;
        }
        Entry::PaintType(value) => {
            scalar(out, &format!("{path}.kind"), "PaintType")?;
            scalar(out, &format!("{path}.value"), value)?;
        }
        Entry::CharstringType(value) => {
            scalar(out, &format!("{path}.kind"), "CharstringType")?;
            scalar(out, &format!("{path}.value"), value)?;
        }
        Entry::FontMatrix(value) => {
            scalar(out, &format!("{path}.kind"), "FontMatrix")?;
            matrix(out, &format!("{path}.value"), Some(value))?;
        }
        Entry::StrokeWidth(value) => {
            scalar(out, &format!("{path}.kind"), "StrokeWidth")?;
            scalar(out, &format!("{path}.value"), value.to_bits())?;
        }
        Entry::FdArrayOffset(value) => {
            scalar(out, &format!("{path}.kind"), "FdArrayOffset")?;
            scalar(out, &format!("{path}.value"), value)?;
        }
        Entry::FdSelectOffset(value) => {
            scalar(out, &format!("{path}.kind"), "FdSelectOffset")?;
            scalar(out, &format!("{path}.value"), value)?;
        }
        Entry::BlueValues(value) => {
            scalar(out, &format!("{path}.kind"), "BlueValues")?;
            blues(out, &format!("{path}.value"), value)?;
        }
        Entry::OtherBlues(value) => {
            scalar(out, &format!("{path}.kind"), "OtherBlues")?;
            blues(out, &format!("{path}.value"), value)?;
        }
        Entry::FamilyBlues(value) => {
            scalar(out, &format!("{path}.kind"), "FamilyBlues")?;
            blues(out, &format!("{path}.value"), value)?;
        }
        Entry::FamilyOtherBlues(value) => {
            scalar(out, &format!("{path}.kind"), "FamilyOtherBlues")?;
            blues(out, &format!("{path}.value"), value)?;
        }
        Entry::SubrsOffset(value) => {
            scalar(out, &format!("{path}.kind"), "SubrsOffset")?;
            scalar(out, &format!("{path}.value"), value)?;
        }
        Entry::VariationStoreIndex(value) => {
            scalar(out, &format!("{path}.kind"), "VariationStoreIndex")?;
            scalar(out, &format!("{path}.value"), value)?;
        }
        Entry::BlueScale(value) => {
            scalar(out, &format!("{path}.kind"), "BlueScale")?;
            scalar(out, &format!("{path}.value"), value.to_bits())?;
        }
        Entry::BlueShift(value) => {
            scalar(out, &format!("{path}.kind"), "BlueShift")?;
            scalar(out, &format!("{path}.value"), value.to_bits())?;
        }
        Entry::BlueFuzz(value) => {
            scalar(out, &format!("{path}.kind"), "BlueFuzz")?;
            scalar(out, &format!("{path}.value"), value.to_bits())?;
        }
        Entry::LanguageGroup(value) => {
            scalar(out, &format!("{path}.kind"), "LanguageGroup")?;
            scalar(out, &format!("{path}.value"), value)?;
        }
        Entry::ExpansionFactor(value) => {
            scalar(out, &format!("{path}.kind"), "ExpansionFactor")?;
            scalar(out, &format!("{path}.value"), value.to_bits())?;
        }
        Entry::Encoding(value) => {
            scalar(out, &format!("{path}.kind"), "Encoding")?;
            scalar(out, &format!("{path}.value"), value)?;
        }
        Entry::Charset(value) => {
            scalar(out, &format!("{path}.kind"), "Charset")?;
            scalar(out, &format!("{path}.value"), value)?;
        }
        Entry::UniqueId(value) => {
            scalar(out, &format!("{path}.kind"), "UniqueId")?;
            scalar(out, &format!("{path}.value"), value)?;
        }
        Entry::Xuid => {
            scalar(out, &format!("{path}.kind"), "Xuid")?;
        }
        Entry::SyntheticBase(value) => {
            scalar(out, &format!("{path}.kind"), "SyntheticBase")?;
            scalar(out, &format!("{path}.value"), value)?;
        }
        Entry::PostScript(value) => {
            scalar(out, &format!("{path}.kind"), "PostScript")?;
            scalar(out, &format!("{path}.value"), value.to_u16())?;
        }
        Entry::BaseFontName(value) => {
            scalar(out, &format!("{path}.kind"), "BaseFontName")?;
            scalar(out, &format!("{path}.value"), value.to_u16())?;
        }
        Entry::BaseFontBlend => {
            scalar(out, &format!("{path}.kind"), "BaseFontBlend")?;
        }
        Entry::Ros {
            registry,
            ordering,
            supplement,
        } => {
            scalar(out, &format!("{path}.kind"), "Ros")?;
            scalar(out, &format!("{path}.registry"), registry.to_u16())?;
            scalar(out, &format!("{path}.ordering"), ordering.to_u16())?;
            scalar(out, &format!("{path}.supplement"), supplement.to_bits())?;
        }
        Entry::CidFontVersion(value) => {
            scalar(out, &format!("{path}.kind"), "CidFontVersion")?;
            scalar(out, &format!("{path}.value"), value.to_bits())?;
        }
        Entry::CidFontRevision(value) => {
            scalar(out, &format!("{path}.kind"), "CidFontRevision")?;
            scalar(out, &format!("{path}.value"), value.to_bits())?;
        }
        Entry::CidFontType(value) => {
            scalar(out, &format!("{path}.kind"), "CidFontType")?;
            scalar(out, &format!("{path}.value"), value)?;
        }
        Entry::CidCount(value) => {
            scalar(out, &format!("{path}.kind"), "CidCount")?;
            scalar(out, &format!("{path}.value"), value)?;
        }
        Entry::UidBase(value) => {
            scalar(out, &format!("{path}.kind"), "UidBase")?;
            scalar(out, &format!("{path}.value"), value)?;
        }
        Entry::FontName(value) => {
            scalar(out, &format!("{path}.kind"), "FontName")?;
            scalar(out, &format!("{path}.value"), value.to_u16())?;
        }
        Entry::StdHw(value) => {
            scalar(out, &format!("{path}.kind"), "StdHw")?;
            scalar(out, &format!("{path}.value"), value.to_bits())?;
        }
        Entry::StdVw(value) => {
            scalar(out, &format!("{path}.kind"), "StdVw")?;
            scalar(out, &format!("{path}.value"), value.to_bits())?;
        }
        Entry::DefaultWidthX(value) => {
            scalar(out, &format!("{path}.kind"), "DefaultWidthX")?;
            scalar(out, &format!("{path}.value"), value.to_bits())?;
        }
        Entry::NominalWidthX(value) => {
            scalar(out, &format!("{path}.kind"), "NominalWidthX")?;
            scalar(out, &format!("{path}.value"), value.to_bits())?;
        }
        Entry::StemSnapH(value) => {
            scalar(out, &format!("{path}.kind"), "StemSnapH")?;
            let values = value.values();
            scalar(out, &format!("{path}.value.length"), values.len())?;
            for (i, v) in values.iter().enumerate() {
                scalar(out, &format!("{path}.value[{i}]"), v.to_bits())?;
            }
        }
        Entry::StemSnapV(value) => {
            scalar(out, &format!("{path}.kind"), "StemSnapV")?;
            let values = value.values();
            scalar(out, &format!("{path}.value.length"), values.len())?;
            for (i, v) in values.iter().enumerate() {
                scalar(out, &format!("{path}.value[{i}]"), v.to_bits())?;
            }
        }
        Entry::ForceBold(value) => {
            scalar(out, &format!("{path}.kind"), "ForceBold")?;
            scalar(out, &format!("{path}.value"), value)?;
        }
        Entry::InitialRandomSeed(value) => {
            scalar(out, &format!("{path}.kind"), "InitialRandomSeed")?;
            scalar(out, &format!("{path}.value"), value)?;
        }
    }
    Ok(())
}
