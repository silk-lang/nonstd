// Copyright 2022 the Fontations Authors. Licensed under Apache-2.0 or MIT.
pub fn dump_bitmap_subtables(
    out: &mut impl Write,
    path: &str,
    value: &BitmapSize,
    base: FontData<'_>,
) -> io::Result<()> {
    let path = &format!("{path}.indexSubtableList");
    crate::dump_support::set_arguments([u64::from(value.number_of_index_subtables()), 0, 0]);
    match value.index_subtable_list(base) {
        Ok(list) => dump_IndexSubtableList(out, path, &list),
        Err(error) => writeln!(out, "{path}.error={}", crate::error(error)),
    }
}
pub fn dump_IndexSubtable(
    out: &mut impl Write,
    path: &str,
    value: &IndexSubtable<'_>,
) -> io::Result<()> {
    writeln!(out, "{path}.kind={}", value.index_format())?;
    match value {
        IndexSubtable::Format1(table) => dump_IndexSubtable1(out, path, table),
        IndexSubtable::Format2(table) => dump_IndexSubtable2(out, path, table),
        IndexSubtable::Format3(table) => dump_IndexSubtable3(out, path, table),
        IndexSubtable::Format4(table) => dump_IndexSubtable4(out, path, table),
        IndexSubtable::Format5(table) => dump_IndexSubtable5(out, path, table),
    }
}
