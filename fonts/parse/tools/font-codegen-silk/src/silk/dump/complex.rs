//! Traversal for parameterized views, computed records and offset graphs.
use super::*;

pub(super) fn imports(out: &mut String, module: &str, silk: bool) {
    if !silk {
        out.push_str("use crate::dump_support::DumpTable;\n");
    }
    let shared = "Lookup, LookupList, LookupList2, ScriptList, FeatureList, FeatureVariations, CoverageTable, ClassDef, DeviceOrVariationIndex, SequenceContext, ChainedSequenceContext, LookupFlag";
    if silk {
        match module {
            "gsub" | "gpos" => {
                writeln!(out, "import read_fonts.tables.layout {{ {shared} }}").unwrap();
                let (kind, aliases) = if module == "gsub" {
                    ("Substitution", "SubstitutionSequenceContext, SubstitutionChainContext")
                } else {
                    ("Position", "PositionSequenceContext, PositionChainContext")
                };
                writeln!(out, "import read_fonts.tables.{module} {{ Original{kind}LookupList, {kind}LookupList2, {aliases} }}").unwrap();
            }
            "gdef" => out.push_str("import read_fonts.tables.layout { CoverageTable, ClassDef, DeviceOrVariationIndex }\nimport read_fonts.tables.variations { ItemVariationStore }\n"),
            "avar" | "hvar" | "vvar" | "mvar" | "colr" => out.push_str("import read_fonts.tables.variations { DeltaSetIndexMap, ItemVariationStore }\n"),
            "gvar" => out.push_str("import read_fonts.tables.gvar { U16Or32 }\nimport read_fonts.tables.variations { Tuple, TupleVariationHeader, TupleVariationCount }\nimport generated_dump_variations { dumpTuple }\n"),
            "base" => out.push_str("import read_fonts.tables.layout { DeviceOrVariationIndex }\nimport read_fonts.tables.variations { ItemVariationStore }\n"),
            "varc" => out.push_str("import read_fonts.tables.layout { CoverageTable, Condition }\n"),
            "math" => out.push_str("import read_fonts.tables.layout { CoverageTable, DeviceOrVariationIndex }\n"),
            "cvar" => out.push_str("import read_fonts.tables.variations { TupleVariationHeader, TupleVariationCount }\n"),
            "meta" => out.push_str("import read_fonts.tables.meta { Metadata, ScriptLangTag }\n"),
            "hdmx" => out.push_str("import read_fonts.tables.hdmx { DeviceRecord }\n"),
            "bitmap" => out.push_str("import read_fonts.tables.bitmap { IndexSubtable }\n"),
            "cblc" | "eblc" => out.push_str("import generated_dump_bitmap { dumpBitmapSize }\n"),
            "vmtx" => out.push_str("import generated_dump_hmtx { dumpLongMetric }\n"),
            "aat" => out.push_str("import read_fonts.tables.aat { LookupU16, TypedLookup }\n"),
            "ankr" => out.push_str("import read_fonts.tables.aat { LookupU16 }\n"),
            "kern" => out.push_str("import generated_dump_kerx { dumpSubtable0Pair }\n"),
            "layout" => out.push_str("import read_fonts.tables.layout { FeatureParams }\n"),
            _ => (),
        }
    } else {
        match module {
            "gsub" | "gpos" => writeln!(out, "use read_fonts::tables::layout::{{{shared}}};").unwrap(),
            "gdef" => out.push_str("use read_fonts::tables::{layout::{CoverageTable, ClassDef, DeviceOrVariationIndex}, variations::ItemVariationStore};\n"),
            "gvar" => out.push_str("use read_fonts::tables::variations::{Tuple, TupleVariationCount, TupleVariationHeader};\nuse crate::generated_dump_variations::dump_Tuple;\n"),
            "base" => out.push_str("use read_fonts::tables::{layout::DeviceOrVariationIndex, variations::ItemVariationStore};\n"),
            "math" => out.push_str("use read_fonts::tables::layout::{CoverageTable, DeviceOrVariationIndex};\n"),
            "cvar" => out.push_str("use read_fonts::tables::variations::{TupleVariationHeader, TupleVariationCount};\n"),
            "colr" => out.push_str("use read_fonts::tables::variations::{DeltaSetIndexMap, ItemVariationStore};\n"),
            "cblc" | "eblc" => out.push_str("use crate::generated_dump_bitmap::dump_BitmapSize;\n"),
            "kern" => out.push_str("use crate::generated_dump_kerx::dump_Subtable0Pair;\n"),
            "vmtx" => out.push_str("use read_fonts::tables::hmtx::LongMetric;\nuse crate::generated_dump_hmtx::dump_LongMetric;\n"),
            _ => (),
        }
    }
}
impl DumpContext<'_> {
    pub(super) fn owner_name(&self, field: &Field) -> String {
        for item in self.cx.items.iter() {
            let fields = match item {
                Item::Table(t) => &t.fields,
                Item::Record(r) => &r.fields,
                _ => continue,
            };
            if fields.iter().any(|f| std::ptr::eq(f, field)) {
                return item.name().to_string();
            }
        }
        unreachable!()
    }
    pub(super) fn dump_args(
        &self,
        out: &mut String,
        name: &str,
        field: &Field,
        offset: bool,
    ) -> syn::Result<()> {
        let attrs = if offset {
            &field.attrs.read_offset_args
        } else {
            &field.attrs.read_with_args
        };
        let (_, fields) = self.cx.owner_fields(field);
        let mut args = Vec::new();
        if let Some(arguments) = attrs {
            for arg in &arguments.inputs {
                let key = camel(&arg.to_string());
                if let Some(f) = fields.find(arg) {
                    let typ = self.cx.field_type(f)?;
                    let value = if self.silk {
                        format!("{}.{key}(&value)", self.cx.applied(name))
                    } else {
                        format!("value.{arg}()")
                    };
                    args.push(if self.silk {
                        match typ.as_str() {
                            "u8" | "u16" | "u32" | "u64" => format!("{typ}.toU64({value})"),
                            "Tag" => format!("u32.toU64(Tag.toU32({value}))"),
                            "GlyphId16" => format!("u32.toU64(GlyphId16.toU32({value}))"),
                            "ValueFormat" | "GvarFlags" => {
                                format!("u16.toU64({typ}.bits(&{value}))")
                            }
                            "TupleIndex" => format!("u16.toU64(TupleIndex.bits({value}))"),
                            _ => {
                                return Err(syn::Error::new(
                                    arg.span(),
                                    "dump argument needs scalar conversion",
                                ))
                            }
                        }
                    } else {
                        match typ.as_str() {
                            "Tag" => {
                                format!("u64::from(u32::from_be_bytes({value}.to_be_bytes()))")
                            }
                            "GlyphId16" => format!("u64::from({value}.to_u32())"),
                            "ValueFormat" | "TupleIndex" | "GvarFlags" => {
                                format!("u64::from({value}.bits())")
                            }
                            _ => format!("u64::from({value})"),
                        }
                    });
                } else {
                    let index = fields
                        .read_args
                        .as_ref()
                        .and_then(|a| a.args.iter().position(|a| a.ident == *arg))
                        .ok_or_else(|| syn::Error::new(arg.span(), "unbound traversal argument"))?;
                    args.push(format!(
                        "{}[{index}]",
                        if self.silk { "dumpArgs" } else { "dump_args" }
                    ));
                }
            }
        }
        args.resize(3, "0".into());
        if self.silk {
            writeln!(out, "  let targetArgs: [u64; 3] = [{}]", args.join(", ")).unwrap();
        } else {
            writeln!(out, "  let target_args: [u64; 3] = [{}];", args.join(", ")).unwrap();
        }
        Ok(())
    }
    pub(super) fn generic(&self, name: &str) -> bool {
        matches!(self.cx.find(name), Some(Item::Table(t)) if t.attrs.generic_offset.is_some())
    }
    pub(super) fn start_extended(&self, out: &mut String, name: &str, record: bool) {
        let generic = self.generic(name);
        if self.silk {
            let parameters = if generic {
                "'a, T: FontRead<'a, ()> + DumpTable<'a>"
            } else {
                "'a"
            };
            let owner = self.cx.applied(name);
            writeln!(out, "pub effect fn dump{name}<{parameters}>(path: &mut DumpPath, value: {owner}{}) -> () ! WriterError ? &mut Writer {{", if record { ", base: FontData<'a>" } else { "" }).unwrap();
            writeln!(out, "  let dumpArgs = DumpPath.arguments(&path)").unwrap();
            if !record && matches!(self.cx.find(name), Some(Item::Table(_))) {
                let id = type_id(&format!(
                    "{}::{name}",
                    self.cx
                        .items
                        .parse_module_path
                        .segments
                        .last()
                        .unwrap()
                        .ident
                ));
                writeln!(out, "  if !run DumpPath.visit(&mut path, {id}, FontData.len(&{owner}.offsetData(&value)), dumpArgs) {{ return }}").unwrap();
            } else {
                writeln!(out, "  if !DumpPath.enter(&mut path) {{ run scalar(&path, \"traversal-limit\") return }}").unwrap();
            }
        } else {
            let parameters = if generic {
                "<'a, T: FontRead<'a, Args = ()> + DumpTable>"
            } else {
                ""
            };
            let owner = if generic {
                format!("{name}<'a, T>")
            } else if !record
                || matches!(self.cx.find(name), Some(Item::Record(r)) if r.lifetime.is_some())
            {
                format!("{name}<'_>")
            } else {
                name.into()
            };
            writeln!(out, "pub fn dump_{name}{parameters}(out: &mut impl Write, path: &str, value: &{owner}{}) -> io::Result<()> {{", if record { ", base: FontData<'_>" } else { "" }).unwrap();
            writeln!(out, "  let dump_args = crate::dump_support::arguments();").unwrap();
            if !record && matches!(self.cx.find(name), Some(Item::Table(_))) {
                let id = type_id(&format!(
                    "{}::{name}",
                    self.cx
                        .items
                        .parse_module_path
                        .segments
                        .last()
                        .unwrap()
                        .ident
                ));
                writeln!(out, "  if !crate::dump_support::visit(out, path, {id}, value.offset_data().len(), dump_args)? {{ return Ok(()); }}").unwrap();
            } else {
                writeln!(out, "  if !crate::dump_support::enter(path) {{ return writeln!(out, \"{{path}}=traversal-limit\"); }}").unwrap();
            }
        }
    }
    pub(super) fn trait_impl(&self, out: &mut String, name: &str) {
        if self.silk {
            let parameters = if self.generic(name) {
                "'a, T: FontRead<'a, ()> + DumpTable<'a>"
            } else {
                "'a"
            };
            let owner = self.cx.applied(name);
            writeln!(out, "// DUMP_IMPL impl<{parameters}> DumpTable<'a> for {owner} {{ effect fn dump(self: &Self, path: &mut DumpPath) -> () ! WriterError ? &mut Writer {{ run dump{name}(&mut path, self.*) }} }}").unwrap();
        } else {
            let (parameters, owner) = if self.generic(name) {
                (
                    "<'a, T: FontRead<'a, Args = ()> + DumpTable>",
                    format!("{name}<'a, T>"),
                )
            } else {
                ("", format!("{name}<'_>"))
            };
            writeln!(out, "impl{parameters} DumpTable for {owner} {{ fn dump(&self, out: &mut impl Write, path: &str) -> io::Result<()> {{ dump_{name}(out, path, self) }} }}").unwrap();
        }
    }
    pub(super) fn group(&self, out: &mut String, group: &GenericGroup) -> syn::Result<()> {
        let name = group.name.to_string();
        self.start(out, &name, false);
        writeln!(out, "  match value {{").unwrap();
        for v in &group.variants {
            let variant = &v.name;
            if self.silk {
                writeln!(out, "    {name}<'a>.{variant} {{ value: table }} => {{ DumpPath.push(&mut path, \"kind\") run scalar(&path, \"{variant}\") DumpPath.pop(&mut path) run DumpTable.dump(&table, &mut path) }}").unwrap();
            } else {
                writeln!(out, "    {name}::{variant}(table) => {{ writeln!(out, \"{{path}}.kind={variant}\")?; table.dump(out, path)?; }}").unwrap();
            }
        }
        writeln!(out, "  }}").unwrap();
        self.end(out);
        self.trait_impl(out, &name);
        Ok(())
    }
    pub(super) fn skipped_getter(
        &self,
        name: &str,
        field: &Field,
        typ: &str,
    ) -> syn::Result<String> {
        let owner = self.cx.applied(name);
        let key = camel(&field.name.to_string());
        if let FieldType::Array { inner_typ } = &field.typ {
            let FieldType::Scalar { typ: scalar } = inner_typ.as_ref() else {
                return Err(syn::Error::new(
                    field.name.span(),
                    "skipped array needs scalar elements",
                ));
            };
            return Ok(if self.silk {
                format!("FontData<'a>.readArray<{scalar}>(&base, {owner}.{key}ByteRange(&value).start, {owner}.{key}ByteRange(&value).end) |> Result<{typ}, ReadError>.unwrapOr(ScalarArray<'a, {scalar}>.empty())")
            } else {
                format!("base.read_array::<BigEndian<{scalar}>>(value.{}_byte_range()).unwrap_or_default()", field.name)
            });
        }
        Ok(if self.silk {
            format!("FontData<'a>.readAt<{typ}>(&base, {owner}.{key}ByteRange(&value).start) |> Result<{typ}, ReadError>.unwrapOr({})", self.cx.fallback(field)?)
        } else {
            format!(
                "base.read_at::<{typ}>(value.{}_byte_range().start).unwrap_or_default()",
                field.name
            )
        })
    }
    pub(super) fn computed_array(
        &self,
        out: &mut String,
        field: &Field,
        typ: &str,
    ) -> syn::Result<()> {
        self.dump_args(out, &self.owner_name(field), field, false)?;
        if typ == "U16Or32" {
            if self.silk {
                let array = self.cx.field_type(field)?;
                writeln!(out, "  DumpPath.push(&mut path, \"length\") run scalar(&path, {array}.len(&fieldValue)) DumpPath.pop(&mut path)\n  let mut index: usize = 0\n  while index < {array}.len(&fieldValue) {{ DumpPath.setIndex(&mut path, index)\n    match move {array}.get(&fieldValue, index) {{ Result<U16Or32, ReadError>.Success {{ value: item }} => run scalar(&path, U16Or32.get(item)) Result<U16Or32, ReadError>.Failure {{ error }} => run readError(&path, error) }}\n    index = index + 1\n  }}\n  DumpPath.clearIndex(&mut path)").unwrap();
            } else {
                writeln!(out, "  writeln!(out, \"{{path}}.length={{}}\", fieldValue.len())?;\n  for (index, item) in fieldValue.iter().enumerate() {{ let path = &format!(\"{{path}}[{{index}}]\"); match item {{ Ok(item) => writeln!(out, \"{{path}}={{}}\", item.get())?, Err(error) => writeln!(out, \"{{path}}.error={{}}\", crate::error(error))?, }} }}").unwrap();
            }
            return Ok(());
        }
        if self.silk {
            let array = self.cx.field_type(field)?;
            writeln!(out, "  DumpPath.push(&mut path, \"length\") run scalar(&path, {array}.len(&fieldValue)) DumpPath.pop(&mut path)\n  let mut index: usize = 0\n  while index < {array}.len(&fieldValue) {{ DumpPath.setIndex(&mut path, index) DumpPath.setArguments(&mut path, targetArgs)\n    match move {array}.get(&fieldValue, index) {{ Result<{typ}<'a>, ReadError>.Success {{ value: item }} => run dump{typ}(&mut path, move item, base) Result<{typ}<'a>, ReadError>.Failure {{ error }} => run readError(&path, error) }}\n    index = index + 1\n  }}\n  DumpPath.clearIndex(&mut path)").unwrap();
        } else {
            writeln!(out, "  writeln!(out, \"{{path}}.length={{}}\", fieldValue.len())?;\n  for (index, item) in fieldValue.iter().enumerate() {{ crate::dump_support::set_arguments(target_args); let path = &format!(\"{{path}}[{{index}}]\"); match item {{ Ok(item) => dump_{typ}(out, path, &item, base)?, Err(error) => writeln!(out, \"{{path}}.error={{}}\", crate::error(error))?, }} }}").unwrap();
        }
        Ok(())
    }
    pub(super) fn variable_array(
        &self,
        out: &mut String,
        field: &Field,
        typ: &str,
    ) -> syn::Result<()> {
        let base_arg = if matches!(self.cx.find(typ), Some(Item::Table(_))) {
            ""
        } else {
            ", base"
        };
        // Variable tables have independent slice ends; equal lengths are not aliases.
        let scope = if base_arg.is_empty() {
            if self.silk {
                "DumpPath.beginTable(&mut path)"
            } else {
                "crate::dump_support::begin_table();"
            }
        } else {
            ""
        };
        if self.silk {
            let array = self.cx.field_type(field)?;
            writeln!(out, "  let mut counter = {array}.iter(&fieldValue)\n  let mut count: usize = 0\n  while true {{ if let Option<Result<{typ}<'a>, ReadError>>.None = move VarLenIter<'a, {typ}<'a>>.next(&mut counter) {{ break }} count = count + 1 }}\n  DumpPath.push(&mut path, \"length\") run scalar(&path, count) DumpPath.pop(&mut path)\n  let mut iter = {array}.iter(&fieldValue)\n  let mut index: usize = 0\n  while index < count {{ {scope} DumpPath.setIndex(&mut path, index)\n    if let Option<Result<{typ}<'a>, ReadError>>.Some {{ value: result }} = move VarLenIter<'a, {typ}<'a>>.next(&mut iter) {{ match move result {{ Result<{typ}<'a>, ReadError>.Success {{ value: item }} => run dump{typ}(&mut path, move item{base_arg}) Result<{typ}<'a>, ReadError>.Failure {{ error }} => run readError(&path, error) }} }}\n    index = index + 1\n  }}\n  DumpPath.clearIndex(&mut path)").unwrap();
        } else {
            writeln!(out, "  writeln!(out, \"{{path}}.length={{}}\", fieldValue.iter().count())?;\n  for (index, item) in fieldValue.iter().enumerate() {{ {scope} let path = &format!(\"{{path}}[{{index}}]\"); match item {{ Ok(item) => dump_{typ}(out, path, &item{base_arg})?, Err(error) => writeln!(out, \"{{path}}.error={{}}\", crate::error(error))?, }} }}").unwrap();
        }
        Ok(())
    }
    pub(super) fn resolved_field(
        &self,
        out: &mut String,
        name: &str,
        field: &Field,
        record: bool,
    ) -> syn::Result<()> {
        if name == "SignatureRecord" && field.name == "signature_block_offset" {
            if self.silk {
                writeln!(out, "  DumpPath.push(&mut path, \"signatureBlock\")\n  match move SignatureRecord<'a>.signatureBlock(&value, base) {{ Option<SignatureBlockFormat1<'a>>.Some {{ value: block }} => run dumpSignatureBlockFormat1(&mut path, block) Option<SignatureBlockFormat1<'a>>.None => run absent(&path) }}\n  DumpPath.pop(&mut path)").unwrap();
            } else {
                writeln!(out, "  {{ let path = &format!(\"{{path}}.signatureBlock\"); match value.signature_block(base) {{ Some(block) => dump_SignatureBlockFormat1(out, path, &block)?, None => writeln!(out, \"{{path}}=none\")?, }} }}").unwrap();
            }
            return Ok(());
        }
        if let FieldType::Offset {
            target: OffsetTarget::Array(inner),
            ..
        } = &field.typ
        {
            return self.resolved_array_field(out, name, field, inner, record);
        }
        let (offset, target, array) = match &field.typ {
            FieldType::Offset {
                typ,
                target: OffsetTarget::Table(target),
            } => (typ, target, false),
            FieldType::Array { inner_typ } => match inner_typ.as_ref() {
                FieldType::Offset {
                    typ,
                    target: OffsetTarget::Table(target),
                } => (typ, target, true),
                _ => return Ok(()),
            },
            _ => return Ok(()),
        };
        let mut getter = field.offset_getter_name().unwrap().to_string();
        let custom = field.attrs.offset_getter.is_some();
        if custom
            && !matches!(
                name,
                "Gdef" | "Gsub" | "Gpos" | "FeatureTableSubstitutionRecord"
            )
        {
            return Ok(());
        }
        if custom && matches!(name, "Gdef" | "Gsub" | "Gpos") {
            getter = format!("original_{getter}");
        }
        let silk_getter = camel(&getter);
        let owner = self.cx.applied(name);
        let target = if target == "T" {
            "T".into()
        } else {
            format!("{target}<'a>")
        };
        let expr = if self.silk {
            format!(
                "{owner}.{silk_getter}(&value{})",
                if record { ", base" } else { "" }
            )
        } else {
            format!("value.{getter}({})", if record { "base" } else { "" })
        };
        if self.silk {
            writeln!(
                out,
                "  if true {{ DumpPath.push(&mut path, \"{silk_getter}\")"
            )
            .unwrap();
        } else {
            writeln!(out, "  {{ let path = &format!(\"{{path}}.{silk_getter}\");").unwrap();
        }
        self.dump_args(out, name, field, true)?;
        let nullable = field.attrs.nullable.is_some();
        if array {
            if self.silk {
                let args = self.cx.field_args(field, true, true)?.0;
                let kind = if nullable {
                    "ArrayOfNullableOffsets"
                } else {
                    "ArrayOfOffsets"
                };
                let typ = format!("{kind}<'a, {args}, {target}, {offset}>");
                writeln!(out, "  let resolvedArray = {expr}\n  DumpPath.push(&mut path, \"length\") run scalar(&path, {typ}.len(&resolvedArray)) DumpPath.pop(&mut path)\n  let mut index: usize = 0\n  while index < {typ}.len(&resolvedArray) {{ DumpPath.setIndex(&mut path, index)").unwrap();
                self.resolve_result(
                    out,
                    &format!("{typ}.get(&resolvedArray, index)"),
                    &target,
                    nullable,
                );
                writeln!(
                    out,
                    "    index = index + 1\n  }}\n  DumpPath.clearIndex(&mut path)"
                )
                .unwrap();
            } else {
                writeln!(out, "  let resolvedArray = {expr};\n  writeln!(out, \"{{path}}.length={{}}\", resolvedArray.len())?;\n  for index in 0..resolvedArray.len() {{ let path = &format!(\"{{path}}[{{index}}]\");").unwrap();
                self.resolve_result(out, "resolvedArray.get(index)", &target, nullable);
                writeln!(out, "  }}").unwrap();
            }
        } else {
            let optional = nullable || field.is_conditional();
            self.resolve_result(out, &expr, &target, optional);
        }
        if self.silk {
            writeln!(out, "  DumpPath.pop(&mut path)").unwrap();
        }
        writeln!(out, "  }}").unwrap();
        Ok(())
    }
    fn resolved_array_field(
        &self,
        out: &mut String,
        name: &str,
        field: &Field,
        inner: &FieldType,
        record: bool,
    ) -> syn::Result<()> {
        let getter = field.offset_getter_name().unwrap().to_string();
        let silk_getter = camel(&getter);
        let mut resolved = field.clone();
        resolved.typ = FieldType::Array {
            inner_typ: Box::new(inner.clone()),
        };
        resolved.attrs.nullable = None;
        let array_type = self.cx.field_type(&resolved)?;
        let result = format!("Result<{array_type}, ReadError>");
        let optional = field.attrs.nullable.is_some() || field.is_conditional();
        if self.silk {
            let owner = self.cx.applied(name);
            writeln!(out, "  if true {{ DumpPath.push(&mut path, \"{silk_getter}\")\n  let arrayResult = {owner}.{silk_getter}(&value{})", if record { ", base" } else { "" }).unwrap();
            if optional {
                writeln!(out, "  match move arrayResult {{ Option<{result}>.None => run absent(&path) Option<{result}>.Some {{ value: resolved }} => {{").unwrap();
            } else {
                writeln!(out, "  let resolved = move arrayResult").unwrap();
            }
            writeln!(out, "  match move resolved {{ {result}.Failure {{ error }} => run readError(&path, error) {result}.Success {{ value: fieldValue }} => {{").unwrap();
        } else {
            writeln!(out, "  {{ let path = &format!(\"{{path}}.{silk_getter}\"); let resolved = value.{getter}({});", if record { "base" } else { "" }).unwrap();
            if optional {
                writeln!(out, "  match resolved {{ None => writeln!(out, \"{{path}}=none\")?, Some(resolved) => {{").unwrap();
            }
            writeln!(out, "  match resolved {{ Err(error) => writeln!(out, \"{{path}}.error={{}}\", crate::error(error))?, Ok(fieldValue) => {{").unwrap();
        }
        self.field_value(out, &resolved)?;
        writeln!(out, "  }} }}").unwrap();
        if optional {
            writeln!(out, "  }} }}").unwrap();
        }
        if self.silk {
            writeln!(out, "  DumpPath.pop(&mut path)").unwrap();
        }
        writeln!(out, "  }}").unwrap();
        Ok(())
    }
    pub(super) fn resolve_result(
        &self,
        out: &mut String,
        expr: &str,
        target: &str,
        optional: bool,
    ) {
        if self.silk {
            writeln!(out, "  DumpPath.setArguments(&mut path, targetArgs)").unwrap();
        } else {
            writeln!(out, "  crate::dump_support::set_arguments(target_args);").unwrap();
        }
        let ret = format!("Result<{target}, ReadError>");
        if optional {
            if self.silk {
                writeln!(out, "  match move {expr} {{ Option<{ret}>.None => run absent(&path) Option<{ret}>.Some {{ value: resolved }} => {{").unwrap();
            } else {
                writeln!(out, "  match {expr} {{ None => writeln!(out, \"{{path}}=none\")?, Some(resolved) => {{").unwrap();
            }
        } else {
            writeln!(
                out,
                "  let resolved = {expr}{}",
                if self.silk { "" } else { ";" }
            )
            .unwrap();
        }
        if target.starts_with("FontData") {
            if self.silk {
                writeln!(out, "  match move resolved {{ {ret}.Success {{ value: table }} => run bytes(&path, FontData.asBytes(&table)) {ret}.Failure {{ error }} => run readError(&path, error) }}").unwrap();
            } else {
                writeln!(out, "  match resolved {{ Ok(table) => {{ write!(out, \"{{path}}=\")?; for byte in table.as_bytes() {{ write!(out, \"{{byte:02x}}\")?; }} writeln!(out)?; }}, Err(error) => writeln!(out, \"{{path}}.error={{}}\", crate::error(error))?, }}").unwrap();
            }
        } else if self.silk {
            writeln!(out, "  match move resolved {{ {ret}.Success {{ value: table }} => run DumpTable.dump(&table, &mut path) {ret}.Failure {{ error }} => run readError(&path, error) }}").unwrap();
        } else {
            writeln!(out, "  match resolved {{ Ok(table) => table.dump(out, path)?, Err(error) => writeln!(out, \"{{path}}.error={{}}\", crate::error(error))?, }}").unwrap();
        }
        if optional {
            writeln!(out, "  }} }}").unwrap();
        }
    }
}

fn type_id(name: &str) -> u32 {
    name.bytes().fold(2166136261u32, |hash, byte| {
        (hash ^ u32::from(byte)).wrapping_mul(16777619)
    })
}
