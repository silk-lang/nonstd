// Copyright 2022 the Fontations Authors. Licensed under Apache-2.0 or MIT.
pub fn dump_FeatureParams(
    out: &mut impl Write,
    path: &str,
    value: &FeatureParams<'_>,
) -> io::Result<()> {
    if !crate::dump_support::enter(path) {
        return writeln!(out, "{path}=traversal-limit");
    }
    match value {
        FeatureParams::StylisticSet(value) => {
            writeln!(out, "{path}.kind=StylisticSet")?;
            value.dump(out, path)?;
        }
        FeatureParams::Size(value) => {
            writeln!(out, "{path}.kind=Size")?;
            value.dump(out, path)?;
        }
        FeatureParams::CharacterVariant(value) => {
            writeln!(out, "{path}.kind=CharacterVariant")?;
            value.dump(out, path)?;
        }
    }
    Ok(())
}
