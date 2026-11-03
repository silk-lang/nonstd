# Hand-edited weights for Silk

An experiment in the style of
[weight-space programming](https://rikiyat.github.io/blog/weight-space-programming/): improve the
tree model on Silk by editing its weights directly, with no gradient descent and no optimizer.
Each edit is a written rule. Its direction comes from the unedited model's own embedding rows,
and a handful of forward passes choose its strength.

`tree.silk-edits.json` is the result. It has the same format, shapes and int6 scales as
`../../model/tree.json`, and differs in 1,149 of 41,609 weights (2.8%), all in the input
embedding table. The lexer still ships the original model; this file is not wired in.

## Results

Part accuracy against the Silk TextMate grammar's labels (Shiki), from the CPU reference forward
pass (`fast.mjs`, which matches gpu-lexer's `treeProbabilities` on every part checked).

| Set | Files | Parts | Original | Edited | Change |
|---|---:|---:|---:|---:|---:|
| Silk test: silk-layout, held out | 70 | 269,246 | 87.84% | 91.60% | +3.75 |
| Silk dev: silk + read-fonts | 180 | 420,457 | 84.20% | 88.05% | +3.85 |
| Guard: 15 other languages | 225 | 250,998 | 83.15% | 84.26% | +1.11 |

Silk test F1 by class: type 52.3 to 67.7, keyword 85.5 to 89.6, operator 95.5 to 97.7, plain
78.3 to 84.5, string 89.6 to 93.3. Function F1 fell slightly (88.0 to 87.5).

Guard by language (original to edited):

| Up | | Down | |
|---|---|---|---|
| Rust | 83.02 to 89.62 | YAML | 67.53 to 59.32 |
| SQL | 45.99 to 49.06 | Markdown | 72.67 to 68.62 |
| TypeScript | 86.53 to 88.77 | JavaScript | 87.52 to 84.95 |
| JSON | 95.04 to 97.15 | Shell | 81.01 to 80.34 |
| Ruby, TOML, C, Python, Go | +0.5 to +1.0 each | HTML | 85.88 to 85.29 |

The settings were chosen on dev and guard; the test set was scored once, after the choice.

For scale: retraining with gradient descent and 93 Silk files (`../../README.md`, Training)
moved Silk accuracy on silk-layout from 88.5% to about 89.0%. That run scored a corpus-selected
subset of silk-layout, so the two numbers are not directly comparable.

## The edits

The model's input is a sum of embedding rows: part kind, length bucket, first character, last
character, two hash buckets of the word, flags and neighbor-pair codes. Silk's grammar is
almost entirely lexical (fixed keyword and primitive lists, `\b[A-Z]\w*\b` is a type, brackets
are punctuation), so the edits act on those rows.

1. **Keywords** (`run mut move match pub effect`). The direction is the mean of the hash rows of
   words the model already calls keywords in every language (`let const impl def struct elif
   return if else while fn import unsafe`) minus the mean for words it reliably calls plain
   (`out value self item err base ...`). Half goes into each of the word's two hash rows, so the
   word gets the full push and an unrelated word sharing one bucket gets half. Each word was
   tried alone first: `drop`, `extern`, `fail`, `once`, `static` and `break` were dropped
   because their buckets collide with common words elsewhere (for example `drop` with `def`,
   `extern` with `impl`), costing other languages more than they gained.
2. **Capitalized words.** The 26 first-character rows `A` to `Z` get a type direction, built
   the same way from words the model already types reliably (`bool str boolean float i8
   ReadError AssertionError Operator Span ...`).
3. **Brackets.** The first- and last-character rows of `( ) [ ]` move 20% of the way toward
   the centroid of the rows of symbols the model reliably calls operators (`+ - * = < > , ; :`
   and so on).

Tried and left out: primitive type names (`usize`, `u8`, ...) helped Silk by only 0.3 points and
cost YAML 2.3. Pushing `Self` toward keyword had no measurable effect. A stronger bracket
edit (60%) erased bracket identity, so words before `(` stopped looking like calls.

## What it costs

The model has no notion of "this file is Silk", so every edit applies to every language.
Capitalized-means-type and brackets-are-operators are also true in Rust, TypeScript, C, Go and
Python's grammars, which is why those improved. JavaScript's grammar labels brackets as plain,
and YAML and Markdown are mostly prose, where capitalized words are not types. A Silk-gated
version would need a language signal carried through the scans and the tree. That is a larger
circuit than these row edits, and it would compete with the 32 channels the model already uses.

## Not verified

The numbers come from the CPU reference pass, not the WebGPU runtime. The port's parity tests
show the runtime matches the original model's spans (`../../README.md`, Parity), and the edited
file has the same layout, so it should behave the same, but this experiment did not run it on a
GPU.

## Reproducing

Needs a gpu-lexer checkout at the commit in `../apply.mjs`, with `node ../apply.mjs` and
`pnpm install` run in it (for Shiki and the Silk grammar), and clones of `silk-lang/silk`,
`julia-script/read-fonts` and `silk-lang/silk-layout` at the commits in `../apply.mjs`.

```sh
export GPU_LEXER=<gpu-lexer checkout> WEIGHT_EDITS_DATA=<scratch dir>
node build-data.mjs <dir with the three clones> <guard list: language<TAB>path per line>
node program.mjs edited.json            # rebuilds tree.silk-edits.json byte for byte
node bench.mjs ../../model/tree.json    # baseline, cached for comparisons
node bench.mjs edited.json dev,guard    # accuracy and per-class F1 against the baseline
node diff.mjs ../../model/tree.json edited.json dev   # which parts were fixed or broken
```

`program.mjs` takes a JSON object to change the strengths (`kw`, `prim`, `cap`, `paren`,
`self`) or the word lists. The guard set used above was files already on the session machine
(Python's standard library, `/usr/include`, Node and npm package sources, system Go, Ruby, SQL
and YAML files), 11 to 16 per language, plus 30 Rust files from the Silk repositories' benchmark code.
