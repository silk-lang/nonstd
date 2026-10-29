// Copyright 2022 the Fontations Authors. Licensed under Apache-2.0 or MIT.
pub fn dump_store_evaluation(
    out: &mut impl Write,
    path: &str,
    table: &ItemVariationStore<'_>,
) -> io::Result<()> {
    let axis_count = table
        .variation_region_list()
        .map(|x| usize::from(x.axis_count()))
        .unwrap_or(0);
    let arrays = table.item_variation_data();
    for (location, coordinate) in [0, -8192, 8192, 16384].into_iter().enumerate() {
        let path = &format!("{path}.evaluated[{location}]");
        writeln!(out, "{path}.coordinate={coordinate}")?;
        let coords = vec![F2Dot14::from_bits(coordinate); axis_count];
        for outer in 0..arrays.len() {
            let path = &format!("{path}.outer[{outer}]");
            match arrays.get(outer) {
                None => writeln!(out, "{path}=none")?,
                Some(Err(error)) => writeln!(out, "{path}.error={}", crate::error(error))?,
                Some(Ok(value)) => {
                    for inner in 0..=usize::from(value.item_count()) {
                        let index = DeltaSetIndex {
                            outer: outer as u16,
                            inner: inner as u16,
                        };
                        match table.compute_delta(index, &coords) {
                            Some(delta) => {
                                writeln!(out, "{path}.inner[{inner}]={}", delta.to_bits())?
                            }
                            None => writeln!(out, "{path}.inner[{inner}]=none")?,
                        }
                    }
                }
            }
        }
    }
    Ok(())
}
