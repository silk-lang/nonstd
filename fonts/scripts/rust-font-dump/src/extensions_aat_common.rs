// Copyright 2022 the Fontations Authors. Licensed under Apache-2.0 or MIT.
use read_fonts::{
    tables::{aat::*, mort, morx},
    types::*,
    FontData, FontRead,
};
use std::{
    fmt::Display,
    io::{self, Write},
};
pub trait StatePayload {
    fn dump(&self, out: &mut impl Write, path: &str) -> io::Result<()>;
}
impl StatePayload for NoPayload {
    fn dump(&self, out: &mut impl Write, path: &str) -> io::Result<()> {
        writeln!(out, "{path}=none")
    }
}
impl StatePayload for () {
    fn dump(&self, out: &mut impl Write, path: &str) -> io::Result<()> {
        writeln!(out, "{path}=none")
    }
}
impl StatePayload for BigEndian<u16> {
    fn dump(&self, out: &mut impl Write, path: &str) -> io::Result<()> {
        writeln!(out, "{path}={}", self.get())
    }
}
impl StatePayload for morx::ContextualEntryData {
    fn dump(&self, out: &mut impl Write, path: &str) -> io::Result<()> {
        writeln!(out, "{path}.markIndex={}", self.mark_index())?;
        writeln!(out, "{path}.currentIndex={}", self.current_index())?;
        Ok(())
    }
}
impl StatePayload for mort::ContextualEntryData {
    fn dump(&self, out: &mut impl Write, path: &str) -> io::Result<()> {
        writeln!(out, "{path}.markOffset={}", self.mark_offset())?;
        writeln!(out, "{path}.currentOffset={}", self.current_offset())?;
        Ok(())
    }
}
impl StatePayload for morx::InsertionEntryData {
    fn dump(&self, out: &mut impl Write, path: &str) -> io::Result<()> {
        writeln!(
            out,
            "{path}.currentInsertIndex={}",
            self.current_insert_index()
        )?;
        writeln!(
            out,
            "{path}.markedInsertIndex={}",
            self.marked_insert_index()
        )?;
        Ok(())
    }
}
impl StatePayload for mort::InsertionEntryData {
    fn dump(&self, out: &mut impl Write, path: &str) -> io::Result<()> {
        writeln!(
            out,
            "{path}.currentInsertIndex={}",
            self.current_insert_index()
        )?;
        writeln!(
            out,
            "{path}.markedInsertIndex={}",
            self.marked_insert_index()
        )?;
        Ok(())
    }
}
pub fn dump_array<T: Scalar + Display>(
    out: &mut impl Write,
    path: &str,
    values: &[BigEndian<T>],
) -> io::Result<()> {
    writeln!(out, "{path}.length={}", values.len())?;
    for (i, value) in values.iter().enumerate() {
        writeln!(out, "{path}[{i}]={}", value.get())?;
    }
    Ok(())
}
pub fn dump_glyphs(
    out: &mut impl Write,
    path: &str,
    values: &[BigEndian<GlyphId16>],
) -> io::Result<()> {
    writeln!(out, "{path}.length={}", values.len())?;
    for (i, value) in values.iter().enumerate() {
        writeln!(out, "{path}[{i}]={}", value.get().to_u32())?;
    }
    Ok(())
}
pub fn dump_lookup_u16(
    out: &mut impl Write,
    path: &str,
    value: &TypedLookup<'_, u16>,
    count: u32,
) -> io::Result<()> {
    crate::dump_support::begin_table();
    crate::generated_dump_aat::dump_Lookup(out, path, &value.lookup)?;
    for gid in (0..=count.min(65535)).chain(std::iter::once(65535)) {
        let path = &format!("{path}.values[{gid}]");
        match value.value(gid as u16) {
            Ok(value) => writeln!(out, "{path}={value}")?,
            Err(error) => writeln!(out, "{path}.error={}", crate::error(error))?,
        }
    }
    Ok(())
}
pub fn dump_lookup_u32(
    out: &mut impl Write,
    path: &str,
    value: &TypedLookup<'_, u32>,
    count: u32,
) -> io::Result<()> {
    crate::dump_support::begin_table();
    crate::generated_dump_aat::dump_Lookup(out, path, &value.lookup)?;
    for gid in (0..=count.min(65535)).chain(std::iter::once(65535)) {
        let path = &format!("{path}.values[{gid}]");
        match value.value(gid as u16) {
            Ok(value) => writeln!(out, "{path}={value}")?,
            Err(error) => writeln!(out, "{path}.error={}", crate::error(error))?,
        }
    }
    Ok(())
}
pub fn dump_legacy_state<T: FixedSize + bytemuck::AnyBitPattern + StatePayload>(
    out: &mut impl Write,
    path: &str,
    value: &StateTable<'_, T>,
    data: FontData<'_>,
    count: u32,
) -> io::Result<()> {
    crate::dump_support::begin_table();
    match StateHeader::read(data) {
        Ok(header) => {
            crate::generated_dump_aat::dump_StateHeader(out, &format!("{path}.header"), &header)?
        }
        Err(error) => writeln!(out, "{path}.header.error={}", crate::error(error))?,
    }
    writeln!(out, "{path}.nClasses={}", value.n_classes)?;
    for gid in 0..=count.min(65535) {
        match value.class(GlyphId16::new(gid as u16)) {
            Ok(value) => writeln!(out, "{path}.classes[{gid}]={value}")?,
            Err(error) => writeln!(out, "{path}.classes[{gid}].error={}", crate::error(error))?,
        }
    }
    for (i, state) in [0, 1, 2, 65535].into_iter().enumerate() {
        for (j, class) in [0, 1, 2, 3, 255, 254].into_iter().enumerate() {
            let path = &format!("{path}.entries[{}]", i * 6 + j);
            match value.entry(state, class) {
                Ok(entry) => {
                    writeln!(out, "{path}.newState={}", entry.new_state)?;
                    writeln!(out, "{path}.flags={}", entry.flags)?;
                    entry.payload.dump(out, &format!("{path}.payload"))?;
                }
                Err(error) => writeln!(out, "{path}.error={}", crate::error(error))?,
            }
        }
    }
    Ok(())
}
pub fn dump_extended_state<T: FixedSize + bytemuck::AnyBitPattern + StatePayload>(
    out: &mut impl Write,
    path: &str,
    value: &ExtendedStateTable<'_, T>,
    data: FontData<'_>,
    count: u32,
) -> io::Result<()> {
    crate::dump_support::begin_table();
    match StxHeader::read(data) {
        Ok(header) => {
            crate::generated_dump_aat::dump_StxHeader(out, &format!("{path}.header"), &header)?
        }
        Err(error) => writeln!(out, "{path}.header.error={}", crate::error(error))?,
    }
    writeln!(out, "{path}.nClasses={}", value.n_classes)?;
    for gid in 0..=count.min(65535) {
        match value.class(GlyphId::new(gid)) {
            Ok(value) => writeln!(out, "{path}.classes[{gid}]={value}")?,
            Err(error) => writeln!(out, "{path}.classes[{gid}].error={}", crate::error(error))?,
        }
    }
    for (i, state) in [0, 1, 2, 65535].into_iter().enumerate() {
        for (j, class) in [0, 1, 2, 3, 255, 65535].into_iter().enumerate() {
            let path = &format!("{path}.entries[{}]", i * 6 + j);
            match value.entry(state, class) {
                Ok(entry) => {
                    writeln!(out, "{path}.newState={}", entry.new_state)?;
                    writeln!(out, "{path}.flags={}", entry.flags)?;
                    entry.payload.dump(out, &format!("{path}.payload"))?;
                }
                Err(error) => writeln!(out, "{path}.error={}", crate::error(error))?,
            }
        }
    }
    Ok(())
}
