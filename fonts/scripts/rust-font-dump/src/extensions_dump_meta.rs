// Copyright 2022 the Fontations Authors. Licensed under Apache-2.0 or MIT.
pub fn dump_Metadata(out: &mut impl Write, path: &str, value: &Metadata<'_>) -> io::Result<()> {
    match value {
        Metadata::Other(data) => {
            writeln!(out, "{path}.kind=Other")?;
            write!(out, "{path}.bytes=")?;
            for byte in *data {
                write!(out, "{byte:02x}")?;
            }
            writeln!(out)?;
        }
        Metadata::ScriptLangTags(tags) => {
            writeln!(out, "{path}.kind=ScriptLangTags")?;
            let mut count = 0;
            for (index, item) in tags.iter().enumerate() {
                match item {
                    Ok(tag) => {
                        write!(out, "{path}.tags[{index}]=")?;
                        for byte in tag.as_str().as_bytes() {
                            write!(out, "{byte:02x}")?;
                        }
                        writeln!(out)?;
                    }
                    Err(error) => {
                        writeln!(out, "{path}.tags[{index}].error={}", crate::error(error))?
                    }
                }
                count += 1;
            }
            writeln!(out, "{path}.tags.length={count}")?;
        }
    }
    Ok(())
}
