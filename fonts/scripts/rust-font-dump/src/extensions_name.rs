use read_fonts::{
    tables::name::{language_id_to_bcp47, Name, NameString},
    ReadError,
};
use std::io::{self, Write};
fn bytes(out: &mut impl Write, path: &str, bytes: &[u8]) -> io::Result<()> {
    write!(out, "{path}=")?;
    for byte in bytes {
        write!(out, "{byte:02x}")?;
    }
    writeln!(out)
}
fn text(
    out: &mut impl Write,
    path: &str,
    name: Result<NameString<'_>, ReadError>,
) -> io::Result<()> {
    match name {
        Err(error) => writeln!(out, "{path}.error={}", crate::error(error)),
        Ok(name) => {
            writeln!(out, "{path}.length={}", name.chars().count())?;
            for (i, c) in name.chars().enumerate() {
                writeln!(out, "{path}[{i}]={}", c as u32)?;
            }
            Ok(())
        }
    }
}
pub fn dump(out: &mut impl Write, path: &str, table: &Name<'_>) -> io::Result<()> {
    let base = table.string_data();
    bytes(out, &format!("{path}.storageBytes"), base.as_bytes())?;
    writeln!(
        out,
        "{path}.decodedNames.length={}",
        table.name_record().len()
    )?;
    for (i, record) in table.name_record().iter().enumerate() {
        let path = format!("{path}.decodedNames[{i}]");
        writeln!(out, "{path}.isUnicode={}", record.is_unicode())?;
        match language_id_to_bcp47(record.platform_id(), record.language_id()) {
            Some(language) => bytes(out, &format!("{path}.language"), language.as_bytes())?,
            None => writeln!(out, "{path}.language=none")?,
        }
        text(out, &format!("{path}.text"), record.string(base))?;
    }
    match table.lang_tag_record() {
        None => writeln!(out, "{path}.decodedLanguageTags=none")?,
        Some(records) => {
            writeln!(out, "{path}.decodedLanguageTags.length={}", records.len())?;
            for (i, record) in records.iter().enumerate() {
                text(
                    out,
                    &format!("{path}.decodedLanguageTags[{i}].text"),
                    record.lang_tag(base),
                )?;
            }
        }
    }
    Ok(())
}
