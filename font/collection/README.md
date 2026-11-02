# font-collection

The fonts an application draws text with, and the order to fall back through them when a
font has no glyph for a character. Face reading and CSS Fonts 4 matching come from
[images-svg-fonts](../../images/svg/fonts); this package adds family lists with generic names,
fallback families and per-character face selection.

- `collection.FontCollection` holds the faces. `add(bytes)` reads a font file (collections add
  every face), `addGeneric(generic, name)` maps `serif`, `sans-serif` and the other generic
  families to a family name, `addScriptFallback(script, name)` registers a family for one
  script and `addFallback(name)` registers a family for any character.
- `collection.Family` is one entry of a `font-family` list: `Family.named(bytes)` or
  `Family.generic(generic)`.
- `chain(families, request, out)` resolves a family list to one matched face per family (CSS
  font matching on weight, width and style), dropping repeats.
- `fallback.FontMatcher` picks the face for each character: the requested families first,
  then the script fallbacks for the character's script, then the general fallbacks, then every
  face in the order it was added. A face qualifies when its `cmap` maps the character.
  Combining marks, joiners, variation selectors and emoji modifiers stay with the face of the
  character before them (`continuesCluster`). Character maps and fallback chains are read once
  and cached.

```silk
let mut fonts = FontCollection.make()
drop run fonts.add(run readFile("NotoSans-Regular.ttf"))
drop run fonts.add(run readFile("Amiri-Regular.ttf"))
run fonts.addScriptFallback(Script.Arabic, String.utf8Bytes("Amiri"))
```

[ui-text](../../ui/text) builds css-layout text measurement on top of this.
