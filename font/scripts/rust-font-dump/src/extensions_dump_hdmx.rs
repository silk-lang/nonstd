// Copyright 2022 the Fontations Authors. Licensed under Apache-2.0 or MIT.
pub fn dump_DeviceRecord(
    out: &mut impl Write,
    path: &str,
    value: &DeviceRecord<'_>,
    _base: FontData<'_>,
) -> io::Result<()> {
    writeln!(out, "{path}.pixelSize={}", value.pixel_size())?;
    writeln!(out, "{path}.maxWidth={}", value.max_width())?;
    write!(out, "{path}.widths=")?;
    for byte in value.widths() {
        write!(out, "{byte:02x}")?;
    }
    writeln!(out)
}
