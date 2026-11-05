// Copyright 2022 the Fontations Authors. Licensed under Apache-2.0 or MIT.
pub fn dump_InstanceRecord(
    out: &mut impl Write,
    path: &str,
    value: &InstanceRecord<'_>,
    _base: FontData<'_>,
) -> io::Result<()> {
    if !crate::dump_support::enter(path) {
        return writeln!(out, "{path}=traversal-limit");
    }
    writeln!(
        out,
        "{path}.subfamilyNameId={}",
        value.subfamily_name_id.to_u16()
    )?;
    writeln!(out, "{path}.flags={}", value.flags)?;
    writeln!(out, "{path}.coordinates.length={}", value.coordinates.len())?;
    for (index, item) in value.coordinates.iter().enumerate() {
        writeln!(out, "{path}.coordinates[{index}]={}", item.get().to_bits())?;
    }
    match value.post_script_name_id {
        Some(item) => writeln!(out, "{path}.postScriptNameId={}", item.to_u16()),
        None => writeln!(out, "{path}.postScriptNameId=none"),
    }
}
