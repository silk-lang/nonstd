// The full hand-written edit program. Each stage is a named, parameterized rule; the
// directions come from the unedited model's own embedding rows.
// node program.mjs <out.json> ['<json params>']
// The defaults are the setting chosen on dev + guard and committed as tree.silk-edits.json.
import { editor, ROW, H } from "./edit.mjs";
const [out, paramsJson] = process.argv.slice(2);
const P = { kw: 1, kwWords: "run,mut,move,match,pub,effect",
  prim: 0, primWords: "usize,isize,u8,u16,u32,u64,i8,i16,i32,i64,f32,f64",
  cap: 1, paren: 0.2, parenChars: "()[]", self: 0, ...JSON.parse(paramsJson ?? "{}") };
const ed = editor(new URL("../../model/tree.json", import.meta.url).pathname);
const mean = (rows) => { const o = new Float32Array(H); for (const r of rows) { const v = ed.baseRow(r); for (let h = 0; h < H; h++) o[h] += v[h] / rows.length; } return o; };

// Donor words: ones the unedited model already labels reliably (measured on guard + Silk dev).
const KW = ["let", "const", "impl", "def", "struct", "elif", "return", "if", "else", "while", "fn", "import", "unsafe"];
const PLAIN = ["out", "value", "self", "item", "err", "base", "fd", "ret", "opts", "msg", "pkg", "opt", "seed", "typ"];
const TYPE = (P.typeDonors ?? "bool,str,boolean,float,i8,ReadError,AssertionError,Operator,Span,WellKnownScalar,ValueError,LineBreak,UrlError,Counter").split(",");
const kwDir = ed.sub(ed.hashMean(KW), ed.hashMean(PLAIN));
const typeDir = ed.sub(ed.hashMean(TYPE), ed.hashMean(PLAIN));

// 1. Silk keywords that the model reads as identifiers.
if (P.kw) for (const w of P.kwWords.split(",")) ed.pushWord(w, kwDir, P.kw, `kw ${w}`);
// 2. Silk's primitive type names.
if (P.prim) for (const w of P.primWords.split(",")) ed.pushWord(w, typeDir, P.prim, `prim ${w}`);
// 2b. Self is a keyword in Silk's grammar; the model calls it a type.
if (P.self) ed.pushWord("Self", ed.sub(kwDir, typeDir), P.self, "Self");
// 3. Capitalized words: Silk's grammar types every \b[A-Z]\w*\b. Lean the uppercase
//    first-character rows toward the type side by the same direction.
if (P.cap) for (let c = 65; c <= 90; c++) ed.addRow(ROW.first + c, typeDir, P.cap, `first ${String.fromCharCode(c)}`);
// 4. Brackets: Silk's grammar marks ( ) [ ] as punctuation (operator). Move the bracket
//    character rows toward the centroid of symbols the model reliably calls operators.
if (P.paren) {
  const ops = [..."+-*=<>,;:&|!?%^~"].map((c) => c.charCodeAt(0));
  for (const which of ["first", "last"]) {
    const centroid = mean(ops.map((c) => ROW[which] + c));
    for (const ch of P.parenChars) {
      const r = ROW[which] + ch.charCodeAt(0);
      ed.addRow(r, ed.sub(centroid, ed.baseRow(r)), P.paren, `${which} ${ch}`);
    }
  }
}
ed.save(out);
console.error(`changed=${ed.changedWeights()} clipped=${ed.log.reduce((a, l) => a + l.clipped, 0)} params=${JSON.stringify(P)}`);
