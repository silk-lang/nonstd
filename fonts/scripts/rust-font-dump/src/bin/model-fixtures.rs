// Copyright 2026 the Fontations Authors. Licensed under Apache-2.0 or MIT.
//! Independent drawn-outline expectations for the upstream model unit tests.
use read_fonts::{
    model::{
        glyph::{outline::ControlBoundsSink, GlyphSource, GlyphSourceOrder},
        Font, NormalizedCoord,
    },
    ps::cff::CffFontRef,
    tables::glyf::outline::{Outline, OutlineTables, PathContourStart, ScaleF32},
    types::{F48Dot16, GlyphId, Tag},
    FontRef,
};
use std::io::{self, Write};

fn main() {
    let kind = std::env::args().nth(1).expect("fixture kind");
    let relative = match kind.as_str() {
        "bitmap-largest" | "bitmap-12" | "bitmap-64" => "cbdt.ttf",
        "varc-cjk" => "varc-6868.ttf",
        "varc-static" => "varc-static-gvar.ttf",
        "varc-conditionals" => "varc-ac01-conditional.ttf",
        "varc-precision" => "varc-delta-precision.ttf",
        "color-variable" | "color-half" | "color-moved" => "test_glyphs-glyf_colr_1_variable.ttf",
        "color-static" | "color-v0" => "test_glyphs-glyf_colr_1.ttf",
        "color-no-clip" => "test_glyphs-glyf_colr_1_no_cliplist.subset.ttf",
        "color-gradient" => "linear_gradient_rect_colr_1.ttf",
        "orders-tinos" => "tinos_subset.ttf",
        "orders-cff" => "noto_serif_display_trimmed.ttf",
        "orders-cbdt" => "cbdt.ttf",
        "orders-colr" => "test_glyphs-glyf_colr_1_variable.ttf",
        "orders-varc" => "varc-6868.ttf",
        "orders-cantarell" | "orders-cantarell650" => "cantarell_vf_trimmed.ttf",
        "glyf" => "vazirmatn_var_trimmed.ttf",
        "cff" => "NotoSansJP-Regular.subset.otf",
        "cff2" => "NotoSansJP-VF.subset.otf",
        _ => panic!("unknown fixture"),
    };
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../parse/upstream/font-test-data/test_data/ttf")
        .join(relative);
    let mut bytes = std::fs::read(path).unwrap();
    if kind == "color-v0" {
        let direct = FontRef::new(&bytes).unwrap();
        let record = direct
            .table_directory()
            .table_records()
            .iter()
            .find(|r| r.tag() == Tag::new(b"COLR"))
            .unwrap();
        let at = record.offset() as usize;
        bytes[at..at + 2].copy_from_slice(&[0, 0]);
    }
    let font = Font::new(bytes.clone(), 0).unwrap();
    let font = if kind == "color-half" {
        font.instance_builder()
            .normalized_coords([NormalizedCoord::from_f32(0.5); 64])
            .build()
    } else if kind == "orders-cantarell650" {
        font.instance_builder()
            .variations([("wght", 650.0)])
            .build()
    } else if kind == "color-moved" {
        font.instance_builder()
            .variations([("CLXI", 200.0)])
            .build()
    } else {
        font
    };
    let mut output = io::stdout().lock();
    if kind.starts_with("orders-") {
        let orders = [
            GlyphSourceOrder::DEFAULT,
            GlyphSourceOrder::OUTLINES,
            GlyphSourceOrder::BASE_OUTLINES,
            GlyphSourceOrder::BITMAPS,
            GlyphSourceOrder::COLOR,
            GlyphSourceOrder::new(&[GlyphSource::Cff, GlyphSource::Glyf, GlyphSource::Colr]),
            GlyphSourceOrder::EMPTY,
        ];
        for (index, order) in orders.into_iter().enumerate() {
            let metrics = font.glyph_metrics().with_extents_source_order(order);
            for gid in 0..=font.num_glyphs() {
                let e = metrics.extents_exact(GlyphId::new(gid));
                output.write_all(&(index as u16).to_be_bytes()).unwrap();
                output
                    .write_all(&u16::from(e.is_some()).to_be_bytes())
                    .unwrap();
                let values = e
                    .map(|e| [e.x_bearing, e.y_bearing, e.width, e.height])
                    .unwrap_or([F48Dot16::ZERO; 4]);
                emit(&mut output, gid, values);
            }
        }
    } else if kind.starts_with("color-") {
        let colors = font.color_glyphs();
        for gid in 0..font.num_glyphs() {
            let Some(glyph) = colors.get(GlyphId::new(gid)) else {
                continue;
            };
            let Ok(e) = glyph.extents() else { continue };
            emit(
                &mut output,
                gid,
                [e.x_bearing, e.y_bearing, e.width, e.height].map(|v| F48Dot16::from_f64(v as f64)),
            );
        }
    } else if kind.starts_with("varc-") {
        let outlines = font.outline_glyphs();
        for gid in 0..font.num_glyphs() {
            let e = outlines.get(GlyphId::new(gid)).unwrap().extents().unwrap();
            emit(
                &mut output,
                gid,
                [e.x_bearing, e.y_bearing, e.width, e.height].map(|v| F48Dot16::from_f64(v as f64)),
            );
        }
    } else if kind.starts_with("bitmap-") {
        let ppem = match kind.as_str() {
            "bitmap-12" => Some(12.0),
            "bitmap-64" => Some(64.0),
            _ => None,
        };
        let glyph = GlyphId::new(2);
        let bitmap = font
            .bitmap_strikes()
            .select(ppem)
            .unwrap()
            .get(glyph)
            .unwrap();
        let e = bitmap.extents();
        emit(
            &mut output,
            2,
            [e.x_bearing, e.y_bearing, e.width, e.height].map(|v| F48Dot16::from_f64(v as f64)),
        );
    } else if kind == "glyf" {
        let coords = [NormalizedCoord::from_f32(-1.0)];
        let direct = FontRef::new(&bytes).unwrap();
        let tables = OutlineTables::new(&direct).unwrap().at(&coords, &[]);
        let mut outline = Outline::<ScaleF32>::new();
        for gid in 0..font.num_glyphs() {
            let loaded = outline.load(&tables, GlyphId::new(gid), None).unwrap();
            let mut sink = ControlBoundsSink::new();
            let _ = loaded.to_path(PathContourStart::ScanBackward, &mut sink);
            let values = sink
                .bounding_box()
                .map(|b| {
                    let x = F48Dot16::from_f64(b.x_min as f64);
                    let y = F48Dot16::from_f64(b.y_max as f64);
                    [
                        x,
                        y,
                        F48Dot16::from_f64(b.x_max as f64) - x,
                        y - F48Dot16::from_f64(b.y_min as f64),
                    ]
                })
                .unwrap_or([F48Dot16::ZERO; 4]);
            emit(&mut output, gid, values);
        }
    } else {
        let direct = FontRef::new(&bytes).unwrap();
        let data = direct
            .table_data(Tag::new(b"CFF2"))
            .or_else(|| direct.table_data(Tag::new(b"CFF ")))
            .unwrap();
        let cff = CffFontRef::new(data.as_bytes(), 0, Some(font.units_per_em() as i32)).unwrap();
        for gid in 0..font.num_glyphs() {
            let glyph = GlyphId::new(gid);
            let subfont = cff.subfont(cff.subfont_index(glyph).unwrap(), &[]).unwrap();
            let mut sink = ControlBoundsSink::new();
            cff.draw(&subfont, glyph, &[], None, &mut sink).unwrap();
            let values = sink
                .bounding_box()
                .map(|b| {
                    [
                        F48Dot16::from_f64(b.x_min as f64),
                        F48Dot16::from_f64(b.y_max as f64),
                        F48Dot16::from_f64((b.x_max - b.x_min) as f64),
                        F48Dot16::from_f64((b.y_max - b.y_min) as f64),
                    ]
                })
                .unwrap_or([F48Dot16::ZERO; 4]);
            emit(&mut output, gid, values);
        }
    }
}
fn emit(out: &mut impl Write, gid: u32, values: [F48Dot16; 4]) {
    out.write_all(&gid.to_be_bytes()).unwrap();
    for value in values {
        out.write_all(&value.to_bits().to_be_bytes()).unwrap();
    }
}
