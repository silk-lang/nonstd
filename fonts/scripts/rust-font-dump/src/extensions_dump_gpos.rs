// Copyright 2022 the Fontations Authors. Licensed under Apache-2.0 or MIT.
pub fn dump_ValueRecord(
    out: &mut impl Write,
    path: &str,
    value: &ValueRecord<'_>,
    base: FontData<'_>,
) -> io::Result<()> {
    if !crate::dump_support::enter(path) {
        return writeln!(out, "{path}=traversal-limit");
    }
    writeln!(out, "{path}.format={}", value.format().bits())?;
    writeln!(out, "{path}.offset={}", value.offset())?;
    match value.bytes() {
        Some(bytes) => {
            write!(out, "{path}.bytes=")?;
            for byte in bytes {
                write!(out, "{byte:02x}")?;
            }
            writeln!(out)?;
        }
        None => writeln!(out, "{path}.bytes=none")?,
    }
    match value.x_placement() {
        Some(v) => writeln!(out, "{path}.xPlacement={v}")?,
        None => writeln!(out, "{path}.xPlacement=none")?,
    }
    match value.device_offset(ValueFormat::X_PLACEMENT_DEVICE) {
        Some(v) => writeln!(out, "{path}.xPlacementDeviceOffset={}", v.offset().to_u32())?,
        None => writeln!(out, "{path}.xPlacementDeviceOffset=none")?,
    }
    {
        let path = &format!("{path}.xPlacementDevice");
        match value.x_placement_device() {
            Some(Ok(v)) => v.dump(out, path)?,
            Some(Err(error)) => writeln!(out, "{path}.error={}", crate::error(error))?,
            None => writeln!(out, "{path}=none")?,
        }
    }
    match value.y_placement() {
        Some(v) => writeln!(out, "{path}.yPlacement={v}")?,
        None => writeln!(out, "{path}.yPlacement=none")?,
    }
    match value.device_offset(ValueFormat::Y_PLACEMENT_DEVICE) {
        Some(v) => writeln!(out, "{path}.yPlacementDeviceOffset={}", v.offset().to_u32())?,
        None => writeln!(out, "{path}.yPlacementDeviceOffset=none")?,
    }
    {
        let path = &format!("{path}.yPlacementDevice");
        match value.y_placement_device() {
            Some(Ok(v)) => v.dump(out, path)?,
            Some(Err(error)) => writeln!(out, "{path}.error={}", crate::error(error))?,
            None => writeln!(out, "{path}=none")?,
        }
    }
    match value.x_advance() {
        Some(v) => writeln!(out, "{path}.xAdvance={v}")?,
        None => writeln!(out, "{path}.xAdvance=none")?,
    }
    match value.device_offset(ValueFormat::X_ADVANCE_DEVICE) {
        Some(v) => writeln!(out, "{path}.xAdvanceDeviceOffset={}", v.offset().to_u32())?,
        None => writeln!(out, "{path}.xAdvanceDeviceOffset=none")?,
    }
    {
        let path = &format!("{path}.xAdvanceDevice");
        match value.x_advance_device() {
            Some(Ok(v)) => v.dump(out, path)?,
            Some(Err(error)) => writeln!(out, "{path}.error={}", crate::error(error))?,
            None => writeln!(out, "{path}=none")?,
        }
    }
    match value.y_advance() {
        Some(v) => writeln!(out, "{path}.yAdvance={v}")?,
        None => writeln!(out, "{path}.yAdvance=none")?,
    }
    match value.device_offset(ValueFormat::Y_ADVANCE_DEVICE) {
        Some(v) => writeln!(out, "{path}.yAdvanceDeviceOffset={}", v.offset().to_u32())?,
        None => writeln!(out, "{path}.yAdvanceDeviceOffset=none")?,
    }
    {
        let path = &format!("{path}.yAdvanceDevice");
        match value.y_advance_device() {
            Some(Ok(v)) => v.dump(out, path)?,
            Some(Err(error)) => writeln!(out, "{path}.error={}", crate::error(error))?,
            None => writeln!(out, "{path}=none")?,
        }
    }
    Ok(())
}
