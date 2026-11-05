// Copyright 2026 The fontations-silk Authors
// SPDX-License-Identifier: MIT OR Apache-2.0

use read_fonts::{types::Tag, FileRef, FontData, FontRead, FontRef, ReadError, TTCHeader};
use std::{
    env,
    ffi::OsStr,
    fs,
    io::{self, Write},
    process::ExitCode,
};

mod dump_support;
mod extensions_aat_common;
mod extensions_aat_misc;
mod extensions_bitmaps;
mod extensions_cff;
mod extensions_cmap;
mod extensions_glyphs;
mod extensions_kern;
mod extensions_kerx;
mod extensions_math;
mod extensions_metric_variations;
mod extensions_metrics;
mod extensions_model;
mod extensions_mort;
mod extensions_morx;
mod extensions_name;
mod extensions_post;
mod extensions_sets;
mod extensions_varc;
mod generated_dump_aat;
mod generated_dump_ankr;
mod generated_dump_base;
mod generated_dump_bitmap;
mod generated_dump_cbdt;
mod generated_dump_cblc;
mod generated_dump_cff;
mod generated_dump_cff2;
mod generated_dump_cmap;
mod generated_dump_colr;
mod generated_dump_cpal;
mod generated_dump_cvar;
mod generated_dump_dsig;
mod generated_dump_ebdt;
mod generated_dump_eblc;
mod generated_dump_feat;
mod generated_dump_gasp;
mod generated_dump_hdmx;
mod generated_dump_head;
mod generated_dump_kern;
mod generated_dump_kerx;
mod generated_dump_ltag;
mod generated_dump_math;
mod generated_dump_maxp;
mod generated_dump_meta;
mod generated_dump_mort;
mod generated_dump_morx;
mod generated_dump_sbix;
mod generated_dump_stat;
mod generated_dump_svg;
mod generated_dump_trak;
mod generated_dump_varc;

mod generated_dump_avar;
mod generated_dump_fvar;
mod generated_dump_gdef;
mod generated_dump_glyf;
mod generated_dump_gpos;
mod generated_dump_gsub;
mod generated_dump_gvar;
mod generated_dump_hhea;
mod generated_dump_hmtx;
mod generated_dump_hvar;
mod generated_dump_layout;
mod generated_dump_mvar;
mod generated_dump_name;
mod generated_dump_os2;
mod generated_dump_post;
mod generated_dump_variations;
mod generated_dump_vhea;
mod generated_dump_vmtx;
mod generated_dump_vorg;
mod generated_dump_vvar;

fn tag(value: Tag) -> String {
    value
        .to_be_bytes()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

// Serialize variants rather than depending on upstream's Display wording.
fn error(value: ReadError) -> String {
    match value {
        ReadError::OutOfBounds => "OutOfBounds".into(),
        ReadError::InvalidFormat(value) => format!("InvalidFormat({value})"),
        ReadError::InvalidSfnt(value) => format!("InvalidSfnt(0x{value:08x})"),
        ReadError::InvalidTtc(value) => format!("InvalidTtc({})", tag(value)),
        ReadError::InvalidCollectionIndex(value) => format!("InvalidCollectionIndex({value})"),
        ReadError::InvalidArrayLen => "InvalidArrayLen".into(),
        ReadError::ValidationError => "ValidationError".into(),
        ReadError::NullOffset => "NullOffset".into(),
        ReadError::TableIsMissing(value) => format!("TableIsMissing({})", tag(value)),
        ReadError::MalformedData(value) => format!("MalformedData({value:?})"),
    }
}

fn optional(value: Option<u32>) -> String {
    value
        .map(|n| n.to_string())
        .unwrap_or_else(|| "none".into())
}

fn dump_font(
    out: &mut impl Write,
    index: usize,
    font: FontRef<'_>,
    include_tables: bool,
    data: &[u8],
) -> io::Result<()> {
    dump_support::reset();
    let prefix = format!("font[{index}]");
    let directory = font.table_directory();
    writeln!(
        out,
        "{prefix}.sfntVersion=0x{:08x}",
        directory.sfnt_version()
    )?;
    writeln!(out, "{prefix}.numTables={}", directory.num_tables())?;
    writeln!(out, "{prefix}.searchRange={}", directory.search_range())?;
    writeln!(out, "{prefix}.entrySelector={}", directory.entry_selector())?;
    writeln!(out, "{prefix}.rangeShift={}", directory.range_shift())?;
    writeln!(
        out,
        "{prefix}.tableRecords.length={}",
        directory.table_records().len()
    )?;
    for (index, record) in directory.table_records().iter().enumerate() {
        let prefix = format!("{prefix}.tableRecords[{index}]");
        writeln!(out, "{prefix}.tag={}", tag(record.tag()))?;
        writeln!(out, "{prefix}.checksum=0x{:08x}", record.checksum())?;
        writeln!(out, "{prefix}.offset={}", record.offset())?;
        writeln!(out, "{prefix}.length={}", record.length())?;
        // Observe FontRef lookup semantics, including duplicate tags and null offsets.
        writeln!(
            out,
            "{prefix}.lookup={}",
            if font.table_data(record.tag()).is_some() {
                "available"
            } else {
                "missing"
            }
        )?;
    }
    if include_tables {
        generated_dump_head::dump_tables(out, &prefix, &font)?;
        generated_dump_maxp::dump_tables(out, &prefix, &font)?;
        generated_dump_cmap::dump_tables(out, &prefix, &font)?;
        generated_dump_hhea::dump_tables(out, &prefix, &font)?;
        generated_dump_hmtx::dump_tables(out, &prefix, &font)?;
        generated_dump_name::dump_tables(out, &prefix, &font)?;
        generated_dump_os2::dump_tables(out, &prefix, &font)?;
        generated_dump_gdef::dump_tables(out, &prefix, &font)?;
        generated_dump_gsub::dump_tables(out, &prefix, &font)?;
        generated_dump_gpos::dump_tables(out, &prefix, &font)?;
        generated_dump_post::dump_tables(out, &prefix, &font)?;
        generated_dump_fvar::dump_tables(out, &prefix, &font)?;
        generated_dump_avar::dump_tables(out, &prefix, &font)?;
        generated_dump_hvar::dump_tables(out, &prefix, &font)?;
        generated_dump_vvar::dump_tables(out, &prefix, &font)?;
        generated_dump_mvar::dump_tables(out, &prefix, &font)?;
        generated_dump_gvar::dump_tables(out, &prefix, &font)?;
        generated_dump_glyf::dump_tables(out, &prefix, &font)?;
        generated_dump_vhea::dump_tables(out, &prefix, &font)?;
        generated_dump_vmtx::dump_tables(out, &prefix, &font)?;
        generated_dump_vorg::dump_tables(out, &prefix, &font)?;
        generated_dump_morx::dump_tables(out, &prefix, &font)?;
        generated_dump_mort::dump_tables(out, &prefix, &font)?;
        generated_dump_kerx::dump_tables(out, &prefix, &font)?;
        generated_dump_trak::dump_tables(out, &prefix, &font)?;
        generated_dump_ankr::dump_tables(out, &prefix, &font)?;
        generated_dump_feat::dump_tables(out, &prefix, &font)?;
        generated_dump_ltag::dump_tables(out, &prefix, &font)?;
        generated_dump_base::dump_tables(out, &prefix, &font)?;
        generated_dump_gasp::dump_tables(out, &prefix, &font)?;
        generated_dump_hdmx::dump_tables(out, &prefix, &font)?;
        generated_dump_stat::dump_tables(out, &prefix, &font)?;
        generated_dump_meta::dump_tables(out, &prefix, &font)?;
        generated_dump_cvar::dump_tables(out, &prefix, &font)?;
        generated_dump_cpal::dump_tables(out, &prefix, &font)?;
        generated_dump_svg::dump_tables(out, &prefix, &font)?;
        generated_dump_dsig::dump_tables(out, &prefix, &font)?;
        generated_dump_sbix::dump_tables(out, &prefix, &font)?;
        generated_dump_cbdt::dump_tables(out, &prefix, &font)?;
        generated_dump_cblc::dump_tables(out, &prefix, &font)?;
        generated_dump_ebdt::dump_tables(out, &prefix, &font)?;
        generated_dump_eblc::dump_tables(out, &prefix, &font)?;
        generated_dump_colr::dump_tables(out, &prefix, &font)?;
        generated_dump_varc::dump_tables(out, &prefix, &font)?;
        generated_dump_math::dump_tables(out, &prefix, &font)?;
        extensions_varc::dump(out, &prefix, &font)?;
        extensions_math::dump(out, &prefix, &font)?;
        extensions_bitmaps::dump(out, &prefix, &font)?;
        extensions_glyphs::dump(out, &prefix, &font)?;
        extensions_morx::dump(out, &prefix, &font)?;
        extensions_mort::dump(out, &prefix, &font)?;
        extensions_kerx::dump(out, &prefix, &font)?;
        extensions_kern::dump(out, &prefix, &font)?;
        extensions_aat_misc::dump(out, &prefix, &font)?;
        extensions_metric_variations::dump(out, &prefix, &font)?;
        extensions_cff::dump(out, &prefix, &font)?;
        extensions_model::dump(out, &prefix, data, index as u32)?;
    }
    Ok(())
}

fn dump(out: &mut impl Write, data: &[u8]) -> io::Result<()> {
    dump_with_tables(out, data, true)
}

fn dump_with_tables(out: &mut impl Write, data: &[u8], include_tables: bool) -> io::Result<()> {
    let header = if include_tables {
        "font-dump.version=9\ndump.scope=all"
    } else {
        "font-dump.version=1\ndump.scope=directory"
    };
    writeln!(out, "{header}\nfile.length={}", data.len())?;
    let file = match FileRef::new(data) {
        Ok(file) => file,
        Err(err) => return writeln!(out, "file.error={}", error(err)),
    };
    match &file {
        FileRef::Font(_) => writeln!(out, "file.kind=sfnt\nfile.fonts=1")?,
        FileRef::Collection(collection) => {
            writeln!(out, "file.kind=ttc\nfile.fonts={}", collection.len())?;
            // CollectionRef accepted exactly these bytes, so the header is readable.
            let header = TTCHeader::read(FontData::new(data)).expect("validated TTC header");
            writeln!(out, "ttc.ttcTag={}", tag(header.ttc_tag()))?;
            writeln!(out, "ttc.version.major={}", header.version().major)?;
            writeln!(out, "ttc.version.minor={}", header.version().minor)?;
            writeln!(out, "ttc.numFonts={}", header.num_fonts())?;
            writeln!(
                out,
                "ttc.tableDirectoryOffsets.length={}",
                header.table_directory_offsets().len()
            )?;
            for (i, offset) in header.table_directory_offsets().iter().enumerate() {
                writeln!(out, "ttc.tableDirectoryOffsets[{i}]={}", offset.get())?;
            }
            writeln!(out, "ttc.dsigTag={}", optional(header.dsig_tag()))?;
            writeln!(out, "ttc.dsigLength={}", optional(header.dsig_length()))?;
            writeln!(out, "ttc.dsigOffset={}", optional(header.dsig_offset()))?;
        }
    }
    for (index, font) in file.fonts().enumerate() {
        match font {
            Ok(font) => dump_font(out, index, font, include_tables, data)?,
            Err(err) => writeln!(out, "font[{index}].error={}", error(err))?,
        }
    }
    Ok(())
}

fn main() -> ExitCode {
    let args: Vec<_> = env::args_os().skip(1).collect();
    if args.len() != 1 {
        eprintln!("usage: rust-font-dump FONT\n       rust-font-dump --help | --version");
        return ExitCode::from(2);
    }
    if args[0] == OsStr::new("--help") {
        println!("usage: rust-font-dump FONT\nDump format 9: tables and model APIs.");
        return ExitCode::SUCCESS;
    }
    if args[0] == OsStr::new("--version") {
        println!("rust-font-dump 0.1.0 (font-dump format 9)");
        return ExitCode::SUCCESS;
    }
    let data = match fs::read(&args[0]) {
        Ok(data) => data,
        Err(err) => {
            eprintln!("rust-font-dump: {}: {err}", args[0].to_string_lossy());
            return ExitCode::from(2);
        }
    };
    let mut out = io::BufWriter::new(io::stdout().lock());
    if let Err(err) = dump(&mut out, &data).and_then(|()| out.flush()) {
        eprintln!("rust-font-dump: stdout: {err}");
        return ExitCode::from(2);
    }
    ExitCode::SUCCESS
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(data: &[u8]) -> String {
        let mut out = Vec::new();
        dump_with_tables(&mut out, data, false).unwrap();
        String::from_utf8(out).unwrap()
    }

    const EMPTY_SFNT: &[u8] = &[0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

    #[test]
    fn empty_directory_golden() {
        assert_eq!(
            text(EMPTY_SFNT),
            concat!(
                "font-dump.version=1\ndump.scope=directory\nfile.length=12\n",
                "file.kind=sfnt\nfile.fonts=1\nfont[0].sfntVersion=0x00010000\n",
                "font[0].numTables=0\nfont[0].searchRange=0\nfont[0].entrySelector=0\n",
                "font[0].rangeShift=0\nfont[0].tableRecords.length=0\n"
            )
        );
    }

    #[test]
    fn truncated_header_is_data_not_process_failure() {
        for size in 0..12 {
            assert!(text(&EMPTY_SFNT[..size]).ends_with("file.error=OutOfBounds\n"));
        }
    }

    #[test]
    fn invalid_sfnt_preserves_error_payload() {
        assert!(text(&[0; 12]).ends_with("file.error=InvalidSfnt(0x00000000)\n"));
    }

    #[test]
    fn table_record_and_unreadable_payload() {
        let mut bytes = EMPTY_SFNT.to_vec();
        bytes[5] = 1;
        bytes.extend_from_slice(b"head\x12\x34\x56\x78\x00\x00\x00\x1c\x00\x00\x00\x04");
        let missing = text(&bytes);
        assert!(missing.contains(".tag=68656164\n"));
        assert!(missing.contains(".checksum=0x12345678\n"));
        assert!(missing.contains(".offset=28\n"));
        assert!(missing.ends_with(".length=4\nfont[0].tableRecords[0].lookup=missing\n"));
        bytes.extend_from_slice(&[0; 4]);
        assert!(text(&bytes).ends_with(".lookup=available\n"));
    }

    #[test]
    fn collection_visits_every_face_and_keeps_face_errors() {
        let mut bytes = b"ttcf\x00\x01\x00\x00\x00\x00\x00\x02".to_vec();
        bytes.extend_from_slice(&20u32.to_be_bytes());
        bytes.extend_from_slice(&32u32.to_be_bytes());
        bytes.extend_from_slice(EMPTY_SFNT);
        bytes.extend_from_slice(&[0; 12]);
        let out = text(&bytes);
        assert!(out.contains("file.kind=ttc\nfile.fonts=2\n"));
        assert!(out.contains("ttc.tableDirectoryOffsets[1]=32\n"));
        assert!(out.contains("font[0].sfntVersion=0x00010000\n"));
        assert!(out.ends_with("font[1].error=InvalidSfnt(0x00000000)\n"));
    }

    #[test]
    fn upstream_truncated_directory_behavior_is_not_overvalidated() {
        let mut bytes = EMPTY_SFNT.to_vec();
        bytes[5] = 1;
        let out = text(&bytes);
        assert!(out.contains("font[0].numTables=1\n"));
        assert!(out.ends_with("font[0].tableRecords.length=0\n"));
    }
}
