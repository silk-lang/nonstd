// Copyright 2022 the Fontations Authors. Licensed under Apache-2.0 or MIT.
use read_fonts::{
    tables::{varc::*, variations::PackedDeltas},
    types::F2Dot14,
    FontRef, TableProvider,
};
use std::io::{self, Write};
fn optional(out: &mut impl Write, path: &str, value: Option<u32>) -> io::Result<()> {
    match value {
        Some(value) => writeln!(out, "{path}={value}"),
        None => writeln!(out, "{path}=none"),
    }
}
fn deltas(out: &mut impl Write, path: &str, values: PackedDeltas<'_>) -> io::Result<()> {
    writeln!(out, "{path}.countOrCompute={}", values.count_or_compute())?;
    let mut count = 0;
    for (index, value) in values.iter().enumerate() {
        writeln!(out, "{path}.values[{index}]={value}")?;
        count = index + 1;
    }
    writeln!(out, "{path}.values.length={count}")
}
fn component(out: &mut impl Write, path: &str, item: &VarcComponent<'_>) -> io::Result<()> {
    writeln!(out, "{path}.flags={}", item.flags().bits())?;
    writeln!(out, "{path}.gid={}", item.gid().to_u32())?;
    optional(
        out,
        &format!("{path}.conditionIndex"),
        item.condition_index(),
    )?;
    optional(
        out,
        &format!("{path}.axisIndicesIndex"),
        item.axis_indices_index(),
    )?;
    optional(
        out,
        &format!("{path}.axisValuesVarIndex"),
        item.axis_values_var_index(),
    )?;
    optional(
        out,
        &format!("{path}.transformVarIndex"),
        item.transform_var_index(),
    )?;
    match item.axis_values() {
        Some(value) => deltas(out, &format!("{path}.axisValues"), value.clone())?,
        None => writeln!(out, "{path}.axisValues=none")?,
    }
    let path = &format!("{path}.transform");
    let transform = item.transform();
    writeln!(
        out,
        "{path}.translateX={}",
        transform.translate_x().to_bits()
    )?;
    writeln!(
        out,
        "{path}.translateY={}",
        transform.translate_y().to_bits()
    )?;
    writeln!(out, "{path}.rotation={}", transform.rotation().to_bits())?;
    writeln!(out, "{path}.scaleX={}", transform.scale_x().to_bits())?;
    writeln!(out, "{path}.scaleY={}", transform.scale_y().to_bits())?;
    writeln!(out, "{path}.skewX={}", transform.skew_x().to_bits())?;
    writeln!(out, "{path}.skewY={}", transform.skew_y().to_bits())?;
    writeln!(out, "{path}.centerX={}", transform.center_x().to_bits())?;
    writeln!(out, "{path}.centerY={}", transform.center_y().to_bits())?;
    for (i, value) in transform.matrix().elements().iter().enumerate() {
        writeln!(out, "{path}.matrix[{i}]={}", value.to_bits())?;
    }
    Ok(())
}
pub fn dump(out: &mut impl Write, path: &str, font: &FontRef<'_>) -> io::Result<()> {
    let Ok(table) = font.varc() else {
        return Ok(());
    };
    let path = &format!("{path}.varcQueries");
    if let Some(Ok(index)) = table.axis_indices_list() {
        for i in 0..index.count() as usize {
            let path = &format!("{path}.axisIndices[{i}]");
            match table.axis_indices(i) {
                Ok(value) => deltas(out, path, value)?,
                Err(error) => writeln!(out, "{path}.error={}", crate::error(error))?,
            }
        }
    }
    if let Ok(index) = table.var_composite_glyphs() {
        for i in 0..index.count() as usize {
            let path = &format!("{path}.glyphs[{i}]");
            match table.glyph(i) {
                Err(error) => writeln!(out, "{path}.error={}", crate::error(error))?,
                Ok(glyph) => {
                    let mut count = 0;
                    for (j, result) in glyph.components().enumerate() {
                        let path = &format!("{path}.components[{j}]");
                        match result {
                            Ok(item) => component(out, path, &item)?,
                            Err(error) => writeln!(out, "{path}.error={}", crate::error(error))?,
                        }
                        count = j + 1;
                    }
                    writeln!(out, "{path}.components.length={count}")?;
                }
            }
        }
    }
    if let Some(Ok(store)) = table.multi_var_store() {
        if let Ok(list) = store.region_list() {
            for (i, result) in list.regions().iter().enumerate() {
                let path = &format!("{path}.regions[{i}]");
                match result {
                    Err(error) => writeln!(out, "{path}.error={}", crate::error(error))?,
                    Ok(region) => {
                        for (c, coord) in [0, 8192, 16384, -8192].into_iter().enumerate() {
                            writeln!(
                                out,
                                "{path}.scalar[{c}]={}",
                                region
                                    .compute_scalar_f32(&[F2Dot14::from_bits(coord); 8])
                                    .to_bits()
                            )?;
                        }
                    }
                }
            }
        }
        for (i, result) in store.variation_data().iter().enumerate() {
            if let Ok(item) = result {
                if let Ok(index) = item.delta_sets() {
                    for j in 0..index.count() as usize {
                        let path = &format!("{path}.variationData[{i}].deltaSets[{j}]");
                        match item.delta_set(j) {
                            Ok(value) => deltas(out, path, value)?,
                            Err(error) => writeln!(out, "{path}.error={}", crate::error(error))?,
                        }
                    }
                }
            }
        }
    }
    Ok(())
}
