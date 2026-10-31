//! Parameterized layout tables, positioned records and typed offset arrays.
use super::*;

impl Context<'_> {
    pub(super) fn count_name(arg: &CountArg) -> String {
        match arg {
            CountArg::Field(id) => camel(&id.to_string()),
            CountArg::Literal(lit) => lit.base10_digits().into(),
        }
    }
    pub(super) fn imports(&self, out: &mut String) {
        let module = self
            .items
            .parse_module_path
            .segments
            .last()
            .unwrap()
            .ident
            .to_string();
        match module.as_str() {
            "layout" => out.push_str("pub import tables.lookup_flag { LookupFlag }\n"),
            "gdef" => out.push_str("import generated_layout { CoverageTable, ClassDef, DeviceOrVariationIndex, HeaderOffset, LayoutOffsetArray }\nimport generated_variations { ItemVariationStore }\n"),
            "gsub" | "gpos" => out.push_str("import generated_layout { Lookup, LookupList, LookupList2, ScriptList, FeatureList, FeatureVariations, CoverageTable, ClassDef, DeviceOrVariationIndex, SequenceContext, ChainedSequenceContext, HeaderOffset, SelectedLookupList, ExtensionLookup, Subtables }\nimport tables.lookup_flag { LookupFlag }\n"),
            "variations" => out.push_str("pub import tables.tuple_index { TupleIndex, TupleVariationCount }\n"),
            "fvar" => out.push_str("pub import tables.instance_record { InstanceRecord }\n"),
            "avar" | "hvar" | "vvar" | "mvar" | "colr" => out.push_str("import generated_variations { DeltaSetIndexMap, ItemVariationStore }\n"),
            "vmtx" => out.push_str("pub import generated_hmtx { LongMetric }\n"),
            "kern" => out.push_str("pub import generated_kerx { Subtable0Pair }\n"),
            "ankr" => out.push_str("import generated_aat { LookupU16 }\n"),
            "gvar" => out.push_str("import generated_variations { Tuple, TupleVariationHeader, TupleVariationCount }\n"),
            "base" => out.push_str("import generated_layout { DeviceOrVariationIndex, Device, VariationIndex }\nimport generated_variations { ItemVariationStore, DeltaSetIndex }\n"),
            "varc" => out.push_str("pub import generated_layout { CoverageTable, Condition }\npub import ps.cff.index { Index2 }\nimport generated_variations { PackedDeltas, DeltaRunIter }\nimport font_data { Cursor }\nimport silk.geometry.affine { Affine2 }\n"),
            "math" => out.push_str("import generated_layout { CoverageTable, DeviceOrVariationIndex, Device }\n"),
            "cvar" => out.push_str("import generated_variations { TupleVariationHeader, TupleVariationCount }\n"),
            "cblc" | "eblc" => out.push_str("pub import generated_bitmap { BitmapSize }\n"),
            _ => (),
        }
    }
    pub(super) fn parameters(&self, name: &str, bounded: bool) -> String {
        if matches!(self.find(name), Some(Item::Table(t)) if t.attrs.generic_offset.is_some()) {
            if bounded {
                "'a, T: FontRead<'a, ()>".into()
            } else {
                "'a, T".into()
            }
        } else {
            "'a".into()
        }
    }
    pub(super) fn applied(&self, name: &str) -> String {
        format!("{name}<{}>", self.parameters(name, false))
    }
    pub(super) fn owner_fields(&self, field: &Field) -> (&str, &Fields) {
        for item in self.items.iter() {
            let (name, fields) = match item {
                Item::Table(t) => (&t.name, &t.fields),
                Item::Record(r) => (&r.name, &r.fields),
                _ => continue,
            };
            if fields.iter().any(|f| std::ptr::eq(f, field)) {
                // Ident spelling is owned by syn; the fields are the relevant lookup.
                let _ = name;
                return ("", fields);
            }
        }
        unreachable!("field must belong to the resolved grammar")
    }
    pub(super) fn field_owner(&self, field: &Field) -> String {
        for item in self.items.iter() {
            let fields = match item {
                Item::Table(t) => &t.fields,
                Item::Record(r) => &r.fields,
                _ => continue,
            };
            if fields.iter().any(|f| std::ptr::eq(f, field)) {
                return self.applied(&item.name().to_string());
            }
        }
        unreachable!()
    }
    pub(super) fn args_type(types: &[String]) -> String {
        match types.len() {
            0 => "()".into(),
            1 => types[0].clone(),
            n => format!("ReadArgs{n}<{}>", types.join(", ")),
        }
    }
    pub(super) fn args_value(types: &[String], values: &[String]) -> String {
        match types.len() {
            0 => "()".into(),
            1 => values[0].clone(),
            _ => format!(
                "{} {{ {} }}",
                Self::args_type(types),
                values
                    .iter()
                    .zip(["first", "second", "third"])
                    .map(|(v, k)| format!("{k}: {v}"))
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
        }
    }
    pub(super) fn args_unpack(args: &[TableReadArg]) -> String {
        match args.len() {
            0 => "".into(),
            1 => ", args".into(),
            _ => ["first", "second", "third"][..args.len()]
                .iter()
                .map(|n| format!(", args.{n}"))
                .collect(),
        }
    }
    pub(super) fn bind_args(out: &mut String, args: &[TableReadArg]) {
        for (i, a) in args.iter().enumerate() {
            let source = if args.len() == 1 {
                "args".into()
            } else {
                format!("args.{}", ["first", "second", "third"][i])
            };
            writeln!(
                out,
                "    let {}Value = {source}",
                camel(&a.ident.to_string())
            )
            .unwrap();
        }
    }
    pub(super) fn field_args(
        &self,
        field: &Field,
        offset: bool,
        getter: bool,
    ) -> syn::Result<(String, String)> {
        let attrs = if offset {
            &field.attrs.read_offset_args
        } else {
            &field.attrs.read_with_args
        };
        let Some(args) = attrs else {
            return Ok(("()".into(), "()".into()));
        };
        let (_, fields) = self.owner_fields(field);
        let mut types = Vec::new();
        let mut values = Vec::new();
        for ident in &args.inputs {
            let name = camel(&ident.to_string());
            if let Some(f) = fields.find(ident) {
                types.push(self.field_type(f)?);
                values.push(if getter {
                    format!("{}.{name}(self)", self.field_owner(field))
                } else {
                    format!("{name}Value")
                });
            } else {
                let arg = fields
                    .read_args
                    .as_ref()
                    .and_then(|a| a.args.iter().find(|a| a.ident == *ident))
                    .ok_or_else(|| syn::Error::new(ident.span(), "unknown read argument"))?;
                types.push(arg.typ.to_string());
                values.push(if getter {
                    format!("self._{name}")
                } else {
                    format!("{name}Value")
                });
            }
        }
        Ok((Self::args_type(&types), Self::args_value(&types, &values)))
    }
    pub(super) fn array_scalar(&self, field: &Field, typ: &str) -> String {
        if field.attrs.nullable.is_some() {
            format!("Nullable<{typ}>")
        } else {
            typ.into()
        }
    }
    pub(super) fn array_element_type(&self, array: &CustomArray) -> String {
        let name = array.raw_inner_type().to_string();
        if array.type_with_lifetime().to_string().contains('<')
            || matches!(self.find(&name), Some(Item::Record(_) | Item::Table(_)))
        {
            format!("{name}<'a>")
        } else {
            name
        }
    }
    pub(super) fn field_length(&self, field: &Field, fields: &Fields) -> syn::Result<String> {
        let (width, variable) = match &field.typ {
            FieldType::ComputedArray(array) | FieldType::VarLenArray(array) => {
                let target = self.array_element_type(array);
                let (args, value) = self.field_args(field, false, false)?;
                (format!("(computeSize<{args}, {target}>({value}) |> Result<usize, ReadError>.unwrapOr(0))"), true)
            }
            FieldType::Struct { typ } if field.attrs.read_with_args.is_some() => {
                let (args, value) = self.field_args(field, false, false)?;
                return Ok(format!("(computeSize<{args}, {typ}<'a>>({value}) |> Result<usize, ReadError>.unwrapOr(0))"));
            }
            FieldType::Array { inner_typ } => (self.type_width(inner_typ)?.to_string(), true),
            _ => (
                self.field_static_width(field)?
                    .ok_or_else(|| syn::Error::new(field.name.span(), "unknown fixed field size"))?
                    .to_string(),
                false,
            ),
        };
        if !variable {
            return Ok(width);
        }
        let count = field.attrs.count.as_deref().unwrap();
        if let FieldType::VarLenArray(array) = &field.typ {
            return Ok(if matches!(count, Count::All(_)) {
                "usize.saturatingSubtract(FontData.len(&data), end)".into()
            } else {
                format!(
                    "varLenBytes<{}>(data, end, {})",
                    self.array_element_type(array),
                    self.count(count, fields)?
                )
            });
        }
        Ok(if matches!(count, Count::All(_)) {
            format!("(usize.saturatingSubtract(FontData.len(&data), end) / {width} * {width})")
        } else {
            format!(
                "usize.saturatingMultiply({}, {width})",
                self.count(count, fields)?
            )
        })
    }
    pub(super) fn offset_getter(
        &self,
        out: &mut String,
        owner: &str,
        field: &Field,
        record: bool,
    ) -> syn::Result<()> {
        if field.attrs.offset_getter.is_some() {
            return Ok(());
        }
        let (offset, target, array, target_array) = match &field.typ {
            FieldType::Offset {
                typ,
                target: OffsetTarget::Table(target),
            } => (typ, self.offset_target_type(target), false, false),
            FieldType::Offset {
                typ,
                target: OffsetTarget::Array(inner),
            } => {
                let name = match inner.as_ref() {
                    FieldType::Scalar { typ } | FieldType::Struct { typ } => typ.to_string(),
                    _ => {
                        return Err(syn::Error::new(
                            field.name.span(),
                            "unsupported offset array element",
                        ))
                    }
                };
                let target = if matches!(self.find(&name), Some(Item::Record(_))) {
                    format!("ComputedArray<'a, (), {name}<'a>>")
                } else {
                    format!("ScalarArray<'a, {name}>")
                };
                (typ, target, false, true)
            }
            FieldType::Array { inner_typ } => match inner_typ.as_ref() {
                FieldType::Offset {
                    typ,
                    target: OffsetTarget::Table(target),
                } => (typ, self.offset_target_type(target), true, false),
                _ => return Ok(()),
            },
            _ => return Ok(()),
        };
        let owner = self.applied(owner);
        let raw = field.name.to_string();
        let name = camel(&raw);
        let getter = camel(&field.offset_getter_name().unwrap().to_string());
        let data_arg = if record { ", data: FontData<'a>" } else { "" };
        let data = if record { "data" } else { "self._fontData" };
        let (mut args, mut value) = self.field_args(field, true, true)?;
        if target_array {
            if !["u8", "u16", "u32", "usize"].contains(&args.as_str()) {
                return Err(syn::Error::new(
                    field.name.span(),
                    "offset array requires one unsigned count",
                ));
            }
            value = self.to_usize(&args, &value);
            args = "usize".into();
        }
        let nullable = field.attrs.nullable.is_some();
        if array {
            let array_name = if nullable {
                "ArrayOfNullableOffsets"
            } else {
                "ArrayOfOffsets"
            };
            let ret = format!("{array_name}<'a, {args}, {target}, {offset}>");
            writeln!(out, "  pub fn {getter}(self: &Self{data_arg}) -> {ret} {{ return {ret}.new({owner}.{name}(self), {data}, {value}) }}").unwrap();
        } else {
            let result = format!("Result<{target}, ReadError>");
            let optional = nullable || field.is_conditional();
            let ret = if optional {
                format!("Option<{result}>")
            } else {
                result.clone()
            };
            writeln!(out, "  pub fn {getter}(self: &Self{data_arg}) -> {ret} {{").unwrap();
            let raw_type = if nullable {
                format!("Nullable<{offset}>")
            } else {
                offset.to_string()
            };
            if field.is_conditional() {
                writeln!(out, "    let offset = match move {owner}.{name}(self) {{ Option<{raw_type}>.Some {{ value }} => value Option<{raw_type}>.None => {{ return {ret}.None }} }}").unwrap();
            } else {
                writeln!(out, "    let offset = {owner}.{name}(self)").unwrap();
            }
            let resolve = if nullable {
                format!(
                    "resolveNullableWithArgs<{args}, {target}, {offset}>(&offset, {data}, {value})"
                )
            } else {
                format!("resolveWithArgs<{args}, {target}, {offset}>(offset, {data}, {value})")
            };
            let resolve = if optional && !nullable {
                format!("{ret}.some({resolve})")
            } else {
                resolve
            };
            writeln!(out, "    return {resolve}\n  }}").unwrap();
        }
        Ok(())
    }
    fn offset_target_type(&self, target: &syn::Ident) -> String {
        if target == "T" {
            "T".into()
        } else {
            format!("{target}<'a>")
        }
    }
    pub(super) fn generic_methods(&self, out: &mut String, table: &Table) -> syn::Result<()> {
        if table.attrs.generic_offset.is_none() {
            return Ok(());
        }
        let name = &table.name;
        let applied = self.applied(&name.to_string());
        writeln!(out, "impl<'a, T> {applied} {{\n  pub fn ofUnitType(self: &Self) -> {name}<'a, ()> {{ return {name}<'a, ()> {{ _fontData: self._fontData, _fieldRanges: self._fieldRanges }} }}").unwrap();
        if let Some(field) = table.fields.iter().find(|f| f.attrs.discriminant.is_some()) {
            let mut offset = 0;
            for f in table.fields.iter().take_while(|f| f.name != field.name) {
                offset += self.field_static_width(f)?.unwrap_or(0);
            }
            let typ = self.field_type(field)?;
            writeln!(out, "  pub fn readDiscriminant(data: FontData<'a>) -> Result<{typ}, ReadError> {{ return FontData<'a>.readAt<{typ}>(&data, {offset}) }}").unwrap();
        }
        writeln!(out, "}}").unwrap();
        Ok(())
    }
    pub(super) fn group(&self, out: &mut String, group: &GenericGroup) -> syn::Result<()> {
        let name = &group.name;
        let inner = &group.inner_type;
        docs(out, &group.attrs.docs);
        writeln!(out, "pub union {name}<'a> {{").unwrap();
        for v in &group.variants {
            writeln!(
                out,
                "  {} {{ pub value: {inner}<'a, {}<'a>> }},",
                v.name, v.typ
            )
            .unwrap();
        }
        writeln!(out,"}}\nimpl<'a> Copy for {name}<'a> {{}}\nimpl<'a> {name}<'a> {{\n  pub fn read(data: FontData<'a>) -> Result<Self, ReadError> {{\n    let discriminant = match move {inner}<'a, ()>.readDiscriminant(data) {{ Result<u16, ReadError>.Success {{ value }} => value Result<u16, ReadError>.Failure {{ error }} => {{ return Result<Self, ReadError>.failResult(error) }} }}\n    match discriminant {{").unwrap();
        for v in &group.variants {
            let target = format!("{inner}<'a, {}<'a>>", v.typ);
            writeln!(out,"      {} => {{ return match move {target}.read(data) {{ Result<{target}, ReadError>.Success {{ value }} => Result<Self, ReadError>.succeed({name}<'a>.{} {{ value: value }}) Result<{target}, ReadError>.Failure {{ error }} => Result<Self, ReadError>.failResult(error) }} }}",v.type_id,v.name).unwrap();
        }
        writeln!(out,"      _ => {{ return Result<Self, ReadError>.failResult(ReadError.InvalidFormat {{ value: u16.toI64(discriminant) }}) }}\n    }}\n  }}\n  pub fn ofUnitType(self: &Self) -> {inner}<'a, ()> {{ return match &self.* {{").unwrap();
        for v in &group.variants {
            writeln!(
                out,
                "    {name}<'a>.{} {{ value }} => {inner}<'a, {}<'a>>.ofUnitType(&value)",
                v.name, v.typ
            )
            .unwrap();
        }
        let v = &group.variants[0];
        writeln!(out,"  }} }}\n  pub fn offsetData(self: &Self) -> FontData<'a> {{ return {inner}<'a, ()>.offsetData(&{name}<'a>.ofUnitType(self)) }}\n  pub fn default() -> Self {{ return {name}<'a>.{} {{ value: {inner}<'a, {}<'a>>.default() }} }}\n}}\nimpl<'a> FontRead<'a, ()> for {name}<'a> {{ fn readWithArgs(data: FontData<'a>, args: ()) -> Result<Self, ReadError> {{ return {name}<'a>.read(data) }} }}",v.name,v.typ).unwrap();
        Ok(())
    }
    pub(super) fn custom_format(&self, out: &mut String, format: &TableFormat) -> syn::Result<()> {
        if format.name == "Glyph" {
            writeln!(out, "pub union Glyph<'a> {{ Simple {{ pub value: SimpleGlyph<'a> }}, Composite {{ pub value: CompositeGlyph<'a> }}, }}\nimpl<'a> Copy for Glyph<'a> {{}}\nimpl<'a> Glyph<'a> {{\n  pub fn read(data: FontData<'a>) -> Result<Self, ReadError> {{\n    let format = match move FontData<'a>.readAt<i16>(&data, 0) {{ Result<i16, ReadError>.Success {{ value }} => value Result<i16, ReadError>.Failure {{ error }} => {{ return Result<Self, ReadError>.failResult(error) }} }}").unwrap();
            for (test, variant, target) in [
                ("format >= 0", "Simple", "SimpleGlyph"),
                ("true", "Composite", "CompositeGlyph"),
            ] {
                writeln!(out, "    if {test} {{ return match move {target}<'a>.read(data) {{ Result<{target}<'a>, ReadError>.Success {{ value }} => Result<Self, ReadError>.succeed(Glyph<'a>.{variant} {{ value: value }}) Result<{target}<'a>, ReadError>.Failure {{ error }} => Result<Self, ReadError>.failResult(error) }} }}").unwrap();
            }
            writeln!(out, "    return Result<Self, ReadError>.failResult(ReadError.OutOfBounds)\n  }}\n  pub fn offsetData(self: &Self) -> FontData<'a> {{ return match &self.* {{ Glyph<'a>.Simple {{ value }} => SimpleGlyph.offsetData(&value) Glyph<'a>.Composite {{ value }} => CompositeGlyph.offsetData(&value) }} }}\n}}\nimpl<'a> FontRead<'a, ()> for Glyph<'a> {{ fn readWithArgs(data: FontData<'a>, args: ()) -> Result<Self, ReadError> {{ return Glyph<'a>.read(data) }} }}").unwrap();
            return Ok(());
        }
        if format.name != "DeviceOrVariationIndex" {
            return Err(syn::Error::new(
                format.name.span(),
                "custom format needs a Silk binding",
            ));
        }
        let name = &format.name;
        writeln!(out,"pub union {name}<'a> {{ Device {{ pub value: Device<'a> }}, VariationIndex {{ pub value: VariationIndex<'a> }}, }}\nimpl<'a> Copy for {name}<'a> {{}}\nimpl<'a> {name}<'a> {{\n  pub fn read(data: FontData<'a>) -> Result<Self, ReadError> {{\n    let format = match move FontData<'a>.readAt<DeltaFormat>(&data, 4) {{ Result<DeltaFormat, ReadError>.Success {{ value }} => value Result<DeltaFormat, ReadError>.Failure {{ error }} => {{ return Result<Self, ReadError>.failResult(error) }} }}").unwrap();
        for (test, target) in [
            ("format == DeltaFormat.VariationIndex", "VariationIndex"),
            ("true", "Device"),
        ] {
            writeln!(out,"    if {test} {{ return match move {target}<'a>.read(data) {{ Result<{target}<'a>, ReadError>.Success {{ value }} => Result<Self, ReadError>.succeed({name}<'a>.{target} {{ value: value }}) Result<{target}<'a>, ReadError>.Failure {{ error }} => Result<Self, ReadError>.failResult(error) }} }}").unwrap();
        }
        writeln!(out,"    return Result<Self, ReadError>.failResult(ReadError.OutOfBounds)\n  }}\n  pub fn offsetData(self: &Self) -> FontData<'a> {{ return match &self.* {{ {name}<'a>.Device {{ value }} => Device<'a>.offsetData(&value) {name}<'a>.VariationIndex {{ value }} => VariationIndex<'a>.offsetData(&value) }} }}\n}}\nimpl<'a> FontRead<'a, ()> for {name}<'a> {{ fn readWithArgs(data: FontData<'a>, args: ()) -> Result<Self, ReadError> {{ return {name}<'a>.read(data) }} }}").unwrap();
        Ok(())
    }
    pub(super) fn computed_record(&self, out: &mut String, record: &Record) -> syn::Result<()> {
        let name = record.name.to_string();
        let fields = &record.fields;
        let args = &record.attrs.read_args.as_ref().unwrap().args;
        let types = args.iter().map(|a| a.typ.to_string()).collect::<Vec<_>>();
        let arg_type = Self::args_type(&types);
        let stored = args
            .iter()
            .map(|a| format!(" _{}: {},", camel(&a.ident.to_string()), a.typ))
            .collect::<String>();
        let init = args
            .iter()
            .map(|a| {
                format!(
                    ", _{}: {}Value",
                    camel(&a.ident.to_string()),
                    camel(&a.ident.to_string())
                )
            })
            .collect::<String>();
        let defaults = Self::args_value(
            &types,
            &types.iter().map(|t| self.default(t)).collect::<Vec<_>>(),
        );
        docs(out, &record.attrs.docs);
        writeln!(out,"pub struct {name}<'a> {{ _fontData: FontData<'a>, _fieldRanges: [ByteRange; {}],{stored} }}\nimpl<'a> Copy for {name}<'a> {{}}\nimpl<'a> {name}<'a> {{\n  pub fn readAt(data: FontData<'a>, position: usize, args: {arg_type}) -> Result<Self, ReadError> {{",fields.iter().count()).unwrap();
        Self::bind_args(out, args);
        writeln!(out,"    let mut ranges = [ByteRange {{ start: 0, end: 0 }}; {}]\n    let mut end = position",fields.iter().count()).unwrap();
        for (i, f) in fields.iter().enumerate() {
            let len = self.field_length(f, fields)?;
            writeln!(out,"    ranges[{i}].start = end\n    end = usize.saturatingAdd(end, {len})\n    ranges[{i}].end = end").unwrap();
        }
        writeln!(
            out,
            "    let value = Self {{ _fontData: data, _fieldRanges: ranges{init} }}"
        )
        .unwrap();
        for (i, f) in fields.iter().enumerate() {
            let read = self
                .read_expr(
                    f,
                    "data",
                    &format!("ranges[{i}].start"),
                    &format!("ranges[{i}].end"),
                )?
                .replace("self.", "value.")
                .replace("(self)", "(&value)");
            let typ = self.field_type(f)?;
            writeln!(out,"    if let Result<{typ}, ReadError>.Failure {{ error }} = move {read} {{ return Result<Self, ReadError>.failResult(error) }}").unwrap();
        }
        writeln!(out,"    return Result<Self, ReadError>.succeed(value)\n  }}\n  pub fn default() -> Self {{ return {name}<'a>.readAt(FontData.defaultTableData(), 0, {defaults}) |> Result<Self, ReadError>.unwrapOr(Self {{ _fontData: FontData.new(b\"\"), _fieldRanges: [ByteRange {{ start: 0, end: 0 }}; {}]{} }}) }}",fields.iter().count(),args.iter().map(|a|format!(", _{}: {}",camel(&a.ident.to_string()),self.default(&a.typ.to_string()))).collect::<String>()).unwrap();
        for (i, f) in fields.iter().enumerate() {
            self.getter(
                out,
                &name,
                f,
                &format!("self._fieldRanges[{i}].start"),
                &format!("self._fieldRanges[{i}].end"),
                true,
            )?;
        }
        writeln!(out,"}}\nimpl<'a> ComputeSize<{arg_type}> for {name}<'a> {{ fn computeSize(args: {arg_type}) -> Result<usize, ReadError> {{").unwrap();
        Self::bind_args(out, args);
        writeln!(out, "    let mut end: usize = 0").unwrap();
        for f in fields.iter() {
            let len = self.field_length(f, fields)?;
            writeln!(out,"    end = match move usize.checkedAdd(end, {len}) {{ Option<usize>.Some {{ value }} => value Option<usize>.None => {{ return Result<usize, ReadError>.failResult(ReadError.OutOfBounds) }} }}").unwrap();
        }
        writeln!(out,"    return Result<usize, ReadError>.succeed(end)\n}} }}\nimpl<'a> FontReadAt<'a, {arg_type}> for {name}<'a> {{ fn readAt(data: FontData<'a>, position: usize, args: {arg_type}) -> Result<Self, ReadError> {{ return {name}<'a>.readAt(data, position, args) }} }}\nimpl<'a> FontRead<'a, {arg_type}> for {name}<'a> {{ fn readWithArgs(data: FontData<'a>, args: {arg_type}) -> Result<Self, ReadError> {{ return {name}<'a>.readAt(data, 0, args) }} }}").unwrap();
        Ok(())
    }

    /// A record whose byte length is encoded in its own prefix (e.g. avar maps).
    /// Unlike a parameterized record, its size cannot be computed from read args.
    pub(super) fn variable_record(&self, out: &mut String, record: &Record) -> syn::Result<()> {
        let name = &record.name;
        let fields = &record.fields;
        let count = fields.iter().count();
        docs(out, &record.attrs.docs);
        writeln!(out, "pub struct {name}<'a> {{ _fontData: FontData<'a>, _fieldRanges: [ByteRange; {count}], }}\nimpl<'a> Copy for {name}<'a> {{}}\nimpl<'a> {name}<'a> {{\n  pub fn read(data: FontData<'a>) -> Result<Self, ReadError> {{\n    let mut ranges = [ByteRange {{ start: 0, end: 0 }}; {count}]\n    let mut end: usize = 0").unwrap();
        for (i, f) in fields.iter().enumerate() {
            let len = self.field_length(f, fields)?;
            writeln!(out, "    ranges[{i}].start = end\n    end = usize.saturatingAdd(end, {len})\n    ranges[{i}].end = end").unwrap();
            if matches!(f.typ, FieldType::Scalar { .. }) {
                let typ = self.field_type(f)?;
                writeln!(out, "    let {}Value = match move FontData<'a>.readAt<{typ}>(&data, ranges[{i}].start) {{ Result<{typ}, ReadError>.Success {{ value }} => value Result<{typ}, ReadError>.Failure {{ error }} => {{ return Result<Self, ReadError>.failResult(error) }} }}", camel(&f.name.to_string())).unwrap();
            }
        }
        writeln!(out, "    if end > FontData.len(&data) {{ return Result<Self, ReadError>.failResult(ReadError.OutOfBounds) }}\n    return Result<Self, ReadError>.succeed(Self {{ _fontData: data, _fieldRanges: ranges }})\n  }}").unwrap();
        for (i, f) in fields.iter().enumerate() {
            self.getter(
                out,
                &name.to_string(),
                f,
                &format!("self._fieldRanges[{i}].start"),
                &format!("self._fieldRanges[{i}].end"),
                true,
            )?;
        }
        writeln!(out, "}}\nimpl<'a> FontRead<'a, ()> for {name}<'a> {{ fn readWithArgs(data: FontData<'a>, args: ()) -> Result<Self, ReadError> {{ return {name}<'a>.read(data) }} }}\nimport read {{ VarSize }}\nimpl<'a> VarSize for {name}<'a> {{ fn readLenAt<'b>(data: FontData<'b>, position: usize) -> Option<usize> {{\n    let mut end = position").unwrap();
        for f in fields.iter() {
            if matches!(f.typ, FieldType::Scalar { .. }) {
                let typ = self.field_type(f)?;
                writeln!(out, "    let {}Value = match move FontData<'b>.readAt<{typ}>(&data, end) {{ Result<{typ}, ReadError>.Success {{ value }} => value _ => {{ return Option<usize>.None }} }}", camel(&f.name.to_string())).unwrap();
            }
            let len = self.field_length(f, fields)?;
            writeln!(out, "    end = match move usize.checkedAdd(end, {len}) {{ Option<usize>.Some {{ value }} => value Option<usize>.None => {{ return Option<usize>.None }} }}").unwrap();
        }
        writeln!(out, "    return Option<usize>.some(end - position)\n}} }}").unwrap();
        Ok(())
    }
}
