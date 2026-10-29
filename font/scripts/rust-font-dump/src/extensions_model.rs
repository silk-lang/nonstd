// Copyright 2026 the Fontations Authors. Licensed under Apache-2.0 or MIT.
//! Stable observations of the requested model APIs, through the public model.
use read_fonts::{
    model::{
        charmap::Charmap,
        glyph::{GlyphSource, GlyphSourceOrder},
        metrics::{GlyphExtents, LineBox, LineExtents, Metrics, Scale26Dot6, ScaleF32},
        name::{GlyphName, GlyphNameSource},
        Font, NormalizedCoord,
    },
    types::{F48Dot16, GlyphId},
};
use std::io::{self, Write};
const GLYPH_LIMIT: u32 = 65_536;
const MAPPING_LIMIT: usize = 1_114_112;
fn scalar(out: &mut impl Write, path: &str, value: impl std::fmt::Display) -> io::Result<()> {
    writeln!(out, "{path}={value}")
}
fn optional(
    out: &mut impl Write,
    path: &str,
    value: Option<impl std::fmt::Display>,
) -> io::Result<()> {
    match value {
        Some(value) => scalar(out, path, value),
        None => scalar(out, path, "none"),
    }
}
fn name(out: &mut impl Write, path: &str, value: Option<GlyphName>, font: &Font) -> io::Result<()> {
    let Some(value) = value else {
        return scalar(out, path, "none");
    };
    let source = match value.source() {
        GlyphNameSource::Post => "Post",
        GlyphNameSource::Cff => "Cff",
        GlyphNameSource::Type1 => "Type1",
        GlyphNameSource::Synthesized => "Synthesized",
    };
    scalar(out, &format!("{path}.source"), source)?;
    write!(out, "{path}.utf8=")?;
    for byte in value.as_str().as_bytes() {
        write!(out, "{byte:02x}")?;
    }
    writeln!(out)?;
    optional(
        out,
        &format!("{path}.reverse"),
        font.glyph_by_name(value.as_str()).map(GlyphId::to_u32),
    )
}
pub fn dump(out: &mut impl Write, prefix: &str, data: &[u8], index: u32) -> io::Result<()> {
    let path = &format!("{prefix}.model");
    let Some(font) = Font::new(data.to_vec(), index) else {
        return scalar(out, &format!("{path}.error"), "InvalidFont");
    };
    scalar(out, &format!("{path}.glyphProbeLimit"), GLYPH_LIMIT)?;
    scalar(out, &format!("{path}.mappingProbeLimit"), MAPPING_LIMIT)?;
    scalar(out, &format!("{path}.axes"), font.axes().len())?;
    charmap(out, &format!("{path}.charmap"), font.charmap())?;
    let mut ids: Vec<u32> = (0..font.num_glyphs().min(GLYPH_LIMIT)).collect();
    for id in [
        font.num_glyphs().saturating_sub(1),
        font.num_glyphs(),
        font.num_glyphs().saturating_add(1),
        u32::MAX,
    ] {
        if !ids.contains(&id) {
            ids.push(id);
        }
    }
    for id in &ids {
        name(
            out,
            &format!("{path}.names[{id}]"),
            font.glyph_name(GlyphId::new(*id)),
            &font,
        )?;
    }
    let mut iter_count = 0;
    for (i, (glyph, value)) in font.glyph_names().take(GLYPH_LIMIT as usize).enumerate() {
        scalar(
            out,
            &format!("{path}.nameIterator[{i}].glyph"),
            glyph.to_u32(),
        )?;
        name(
            out,
            &format!("{path}.nameIterator[{i}].name"),
            Some(value),
            &font,
        )?;
        iter_count += 1;
    }
    scalar(out, &format!("{path}.nameIterator.length"), iter_count)?;
    let locations: &[i16] = if font.axes().is_empty() {
        &[0]
    } else {
        &[0, -8192, 8192, 16384]
    };
    for (location, coord) in locations.iter().enumerate() {
        let instance = font
            .instance_builder()
            .normalized_coords(std::iter::repeat_n(
                NormalizedCoord::from_bits(*coord),
                font.axes().len() as usize,
            ))
            .build();
        let loc = &format!("{path}.locations[{location}]");
        scalar(out, &format!("{loc}.coord"), coord)?;
        scalar(
            out,
            &format!("{loc}.coordinates"),
            instance.normalized_coords().len(),
        )?;
        global(out, &format!("{loc}.metrics"), instance.metrics())?;
        let metrics = instance.glyph_metrics();
        scalar(out, &format!("{loc}.extentsSourceOrder"), "default")?;
        let fine = metrics.scaled(ScaleF32::from_ppem(16.0, font.units_per_em()));
        let coarse = metrics.scaled(Scale26Dot6::from_ppem(16.0, font.units_per_em()));
        for id in &ids {
            let gid = GlyphId::new(*id);
            let child = &format!("{loc}.glyphs[{id}]");
            scalar(
                out,
                &format!("{child}.hAdvance"),
                metrics.h_advance_exact(gid).to_bits(),
            )?;
            scalar(
                out,
                &format!("{child}.vAdvance"),
                metrics.v_advance_exact(gid).to_bits(),
            )?;
            scalar(
                out,
                &format!("{child}.vOriginY"),
                metrics.v_origin_y_exact(gid).to_bits(),
            )?;
            extents(
                out,
                &format!("{child}.extents"),
                metrics.extents_exact(gid),
                F48Dot16::to_bits,
            )?;
            scalar(
                out,
                &format!("{child}.f32.hAdvance"),
                fine.h_advance(gid).to_bits(),
            )?;
            scalar(
                out,
                &format!("{child}.f32.vAdvance"),
                fine.v_advance(gid).to_bits(),
            )?;
            scalar(
                out,
                &format!("{child}.f32.vOriginY"),
                fine.v_origin_y(gid).to_bits(),
            )?;
            extents(
                out,
                &format!("{child}.f32.extents"),
                fine.extents(gid),
                f32::to_bits,
            )?;
            scalar(
                out,
                &format!("{child}.f26.hAdvance"),
                coarse.h_advance(gid).to_bits(),
            )?;
            scalar(
                out,
                &format!("{child}.f26.vAdvance"),
                coarse.v_advance(gid).to_bits(),
            )?;
            scalar(
                out,
                &format!("{child}.f26.vOriginY"),
                coarse.v_origin_y(gid).to_bits(),
            )?;
            extents(
                out,
                &format!("{child}.f26.extents"),
                coarse.extents(gid),
                |v| v.to_bits(),
            )?;
        }
        let count = font.num_glyphs();
        let probes = [0, 1, 2, 31, count.saturating_sub(1), count, u32::MAX];
        let orders = [
            GlyphSourceOrder::OUTLINES,
            GlyphSourceOrder::BASE_OUTLINES,
            GlyphSourceOrder::BITMAPS,
            GlyphSourceOrder::COLOR,
            GlyphSourceOrder::EMPTY,
            GlyphSourceOrder::new(&[GlyphSource::Cff, GlyphSource::Glyf, GlyphSource::Colr]),
        ];
        for (order_index, order) in orders.into_iter().enumerate() {
            let selected = metrics.with_extents_source_order(order);
            for gid in probes {
                extents(
                    out,
                    &format!("{loc}.sourceOrders[{order_index}].glyphs[{gid}]"),
                    selected.extents_exact(GlyphId::new(gid)),
                    F48Dot16::to_bits,
                )?;
            }
        }
        for (size_index, ppem) in [12.0f32, 64.0].into_iter().enumerate() {
            let selected = metrics.scaled(ScaleF32::from_ppem(ppem, font.units_per_em()));
            scalar(
                out,
                &format!("{loc}.bitmapSizes[{size_index}].ppem"),
                ppem.to_bits(),
            )?;
            for gid in probes {
                extents(
                    out,
                    &format!("{loc}.bitmapSizes[{size_index}].glyphs[{gid}]"),
                    selected.extents(GlyphId::new(gid)),
                    f32::to_bits,
                )?;
            }
        }
    }
    Ok(())
}
fn extents<T, O: std::fmt::Display>(
    out: &mut impl Write,
    path: &str,
    value: Option<GlyphExtents<T>>,
    convert: impl Fn(T) -> O,
) -> io::Result<()> {
    let Some(e) = value else {
        return scalar(out, path, "none");
    };
    scalar(out, &format!("{path}.xBearing"), convert(e.x_bearing))?;
    scalar(out, &format!("{path}.yBearing"), convert(e.y_bearing))?;
    scalar(out, &format!("{path}.width"), convert(e.width))?;
    scalar(out, &format!("{path}.height"), convert(e.height))
}
fn line(out: &mut impl Write, path: &str, value: Option<LineBox>) -> io::Result<()> {
    let Some(e) = value else {
        return scalar(out, path, "none");
    };
    scalar(out, &format!("{path}.ascender"), e.ascender.to_bits())?;
    scalar(out, &format!("{path}.descender"), e.descender.to_bits())?;
    scalar(out, &format!("{path}.lineGap"), e.line_gap.to_bits())
}
fn line_ends(
    out: &mut impl Write,
    path: &str,
    value: Option<LineExtents<F48Dot16>>,
) -> io::Result<()> {
    let Some(e) = value else {
        return scalar(out, path, "none");
    };
    scalar(out, &format!("{path}.ascender"), e.ascender.to_bits())?;
    scalar(out, &format!("{path}.descender"), e.descender.to_bits())
}
fn global(out: &mut impl Write, path: &str, value: &Metrics) -> io::Result<()> {
    scalar(out, &format!("{path}.unitsPerEm"), value.units_per_em)?;
    scalar(
        out,
        &format!("{path}.rawUnitsPerEm"),
        value.raw_units_per_em,
    )?;
    scalar(out, &format!("{path}.numGlyphs"), value.num_glyphs)?;
    scalar(
        out,
        &format!("{path}.bounds.xMin"),
        value.bounds.x_min.to_bits(),
    )?;
    scalar(
        out,
        &format!("{path}.bounds.yMin"),
        value.bounds.y_min.to_bits(),
    )?;
    scalar(
        out,
        &format!("{path}.bounds.xMax"),
        value.bounds.x_max.to_bits(),
    )?;
    scalar(
        out,
        &format!("{path}.bounds.yMax"),
        value.bounds.y_max.to_bits(),
    )?;
    line(out, &format!("{path}.hheaLine"), value.hhea_line)?;
    line(out, &format!("{path}.vheaLine"), value.vhea_line)?;
    line(out, &format!("{path}.typoLine"), value.typo_line)?;
    scalar(
        out,
        &format!("{path}.useTypoMetrics"),
        value.use_typo_metrics,
    )?;
    line_ends(out, &format!("{path}.winLine"), value.win_line)?;
    line(out, &format!("{path}.hLine"), value.h_line())?;
    for (name, v) in [
        ("maxHAdvance", value.max_h_advance),
        ("maxVAdvance", value.max_v_advance),
        ("xHeight", value.x_height),
        ("capHeight", value.cap_height),
        ("averageCharWidth", value.average_char_width),
    ] {
        optional(out, &format!("{path}.{name}"), v.map(F48Dot16::to_bits))?;
    }
    Ok(())
}
fn charmap(out: &mut impl Write, path: &str, map: Charmap<'_>) -> io::Result<()> {
    scalar(out, &format!("{path}.hasUnicode"), map.has_unicode())?;
    scalar(
        out,
        &format!("{path}.unicodeIsSymbol"),
        map.unicode_is_symbol(),
    )?;
    scalar(
        out,
        &format!("{path}.unicodeIsMacRoman"),
        map.unicode_is_mac_roman(),
    )?;
    scalar(
        out,
        &format!("{path}.hasUnicodeVariants"),
        map.has_unicode_variants(),
    )?;
    let probes = [
        0,
        1,
        32,
        65,
        66,
        127,
        128,
        255,
        256,
        233,
        0x400,
        0xf041,
        0xffff,
        0x10000,
        0x10ffff,
        0x110000,
        u32::MAX,
        65,
        32,
        0,
    ];
    let mut batch = [GlyphId::NOTDEF; 20];
    let initial = map.map_unicode_batched(probes.into_iter().zip(batch.iter_mut()));
    scalar(out, &format!("{path}.batch.initial"), initial)?;
    for (i, cp) in probes.iter().enumerate() {
        scalar(out, &format!("{path}.probes[{i}].code"), cp)?;
        optional(
            out,
            &format!("{path}.probes[{i}].glyph"),
            map.map_unicode(*cp).map(GlyphId::to_u32),
        )?;
        scalar(out, &format!("{path}.probes[{i}].batch"), batch[i].to_u32())?;
    }
    let mut count = 0;
    for (i, (cp, glyph)) in map.unicodes().take(MAPPING_LIMIT).enumerate() {
        scalar(out, &format!("{path}.unicodes[{i}].code"), cp)?;
        scalar(out, &format!("{path}.unicodes[{i}].glyph"), glyph.to_u32())?;
        optional(
            out,
            &format!("{path}.unicodes[{i}].lookup"),
            map.map_unicode(cp).map(GlyphId::to_u32),
        )?;
        count += 1;
    }
    scalar(out, &format!("{path}.unicodes.length"), count)?;
    count = 0;
    for (i, (cp, selector, glyph)) in map.unicode_variants().take(MAPPING_LIMIT).enumerate() {
        scalar(out, &format!("{path}.variants[{i}].code"), cp)?;
        scalar(out, &format!("{path}.variants[{i}].selector"), selector)?;
        scalar(out, &format!("{path}.variants[{i}].glyph"), glyph.to_u32())?;
        optional(
            out,
            &format!("{path}.variants[{i}].lookup"),
            map.map_unicode_variant(cp, selector).map(GlyphId::to_u32),
        )?;
        count += 1;
    }
    scalar(out, &format!("{path}.variants.length"), count)?;
    count = 0;
    for (i, encoding) in map.encodings().enumerate() {
        let child = &format!("{path}.encodings[{i}]");
        scalar(out, &format!("{child}.kind"), encoding.kind() as u32)?;
        optional(
            out,
            &format!("{child}.tag"),
            encoding
                .sfnt_index()
                .map(|(tag, _)| u32::from_be_bytes(tag.to_be_bytes())),
        )?;
        optional(
            out,
            &format!("{child}.index"),
            encoding.sfnt_index().map(|(_, index)| index),
        )?;
        optional(
            out,
            &format!("{child}.platform"),
            encoding.sfnt_ids().map(|(platform, _)| platform),
        )?;
        optional(
            out,
            &format!("{child}.encoding"),
            encoding.sfnt_ids().map(|(_, encoding)| encoding),
        )?;
        let mut code_count = 0;
        for (n, (cp, glyph)) in map.codes(encoding).take(MAPPING_LIMIT).enumerate() {
            scalar(out, &format!("{child}.codes[{n}].code"), cp)?;
            scalar(out, &format!("{child}.codes[{n}].glyph"), glyph.to_u32())?;
            optional(
                out,
                &format!("{child}.codes[{n}].lookup"),
                map.map_code(encoding, cp).map(GlyphId::to_u32),
            )?;
            code_count += 1;
        }
        scalar(out, &format!("{child}.codes.length"), code_count)?;
        count += 1;
    }
    scalar(out, &format!("{path}.encodings.length"), count)
}
