//! MATH constant selectors follow the field order defined by the table grammar.
use super::*;

pub(super) fn constants(cx: &Context<'_>, out: &mut String) -> syn::Result<()> {
    let Some(Item::Table(table)) = cx.find("MathConstants") else {
        unreachable!()
    };
    let fields = table.fields.iter().collect::<Vec<_>>();
    let names = fields
        .iter()
        .map(|field| {
            let name = camel(&field.name.to_string());
            format!("{}{}", name[..1].to_uppercase(), &name[1..])
        })
        .collect::<Vec<_>>();
    writeln!(out, "pub enum(u8) MathConstant {{").unwrap();
    for (index, name) in names.iter().enumerate() {
        writeln!(out, "  {name} = {index},").unwrap();
    }
    writeln!(out, "}}\nimpl MathConstant {{\n  pub fn new(value: u8) -> Option<Self> {{ return match value {{").unwrap();
    for (index, name) in names.iter().enumerate() {
        writeln!(out, "    {index} => Option<Self>.some(MathConstant.{name})").unwrap();
    }
    writeln!(out, "    _ => Option<Self>.None\n  }} }}\n  pub fn all() -> [MathConstant; {}] {{ return [{}] }}\n}}", names.len(), names.iter().map(|name| format!("MathConstant.{name}")).collect::<Vec<_>>().join(", ")).unwrap();
    writeln!(out, "impl<'a> MathConstants<'a> {{").unwrap();
    for sized in [false, true] {
        let (method, args, result) = if sized {
            ("constantForPpem", ", ppem: u16", "MathValue")
        } else {
            ("constant", "", "i32")
        };
        writeln!(out, "  pub fn {method}(self: &Self, constant: MathConstant{args}) -> {result} {{ return match constant {{").unwrap();
        for (field, name) in fields.iter().zip(&names) {
            let method = camel(&field.name.to_string());
            let read = format!("MathConstants.{method}(self)");
            let value = match &field.typ {
                FieldType::Scalar { typ } if typ == "i16" => format!("i16.toI32({read})"),
                FieldType::Scalar { typ } if typ == "UfWord" => {
                    format!("u16.toI32(UfWord.toU16({read}))")
                }
                FieldType::Struct { typ } if typ == "MathValueRecord" => {
                    if sized {
                        writeln!(out, "    MathConstant.{name} => MathValueRecord.valueForPpem(&{read},MathConstants.offsetData(self),ppem)").unwrap();
                        continue;
                    }
                    format!("i16.toI32(FWord.toI16(MathValueRecord.value(&{read})))")
                }
                _ => {
                    return Err(syn::Error::new(
                        field.name.span(),
                        "unexpected MATH constant type",
                    ))
                }
            };
            if sized {
                writeln!(
                    out,
                    "    MathConstant.{name} => MathValue {{ value: {value}, deltaPx: 0 }}"
                )
                .unwrap();
            } else {
                writeln!(out, "    MathConstant.{name} => {value}").unwrap();
            }
        }
        writeln!(out, "  }} }}").unwrap();
    }
    writeln!(out, "}}").unwrap();
    Ok(())
}
