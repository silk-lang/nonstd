These original constant-color JPEG images were encoded with Pillow for the JPEG decoder tests. They cover grayscale/RGB baseline and progressive streams and EXIF orientation. `../jpeg_fixtures.py` regenerates the five header fixtures and embedded Silk vectors from the repository root; Pillow/libjpeg versions may affect encoded bytes, so regeneration is intentional rather than part of the normal gate.

Header tests do not establish successful entropy decoding. Pixel-decoder tests will consume these same fixtures as that implementation is added.

`grayGradient.jpg` and `grayRestart.jpg` are additional original 17×9 grayscale pixel fixtures. The former exercises AC reconstruction; the latter has a restart interval of one MCU and five restart markers. Pixel expectations were obtained independently with Pillow; the tests allow one sample level for differing IDCT rounding.

`../jpeg_progressive_fixtures.py` generates original 23×19 varying-pixel images
in grayscale and 4:4:4, 4:2:2 and 4:2:0 RGB, with and without restart markers.
Tests compare progressive reconstruction exactly against sequential encoding of
the same coefficients. This checks scan equivalence, not independent color or
IDCT accuracy; the separate pixel and IDCT tests cover those contracts. The
script also assembles a three-scan sequential constant image from T.81 marker
and Huffman syntax, and generates malformed progression/restart/truncation tests.

`../jpeg_metadata_fixtures.py` inserts original APP1/APP2 segments to cover EXIF
coexisting with XMP, reordered ICC chunks, chunks between progressive scans and
invalid sequence framing. Its opaque profile payload tests byte transport only,
not ICC profile validity. `orientation_tests.silk` independently specifies all
eight exact pixel permutations of a labelled 3×2 image, including alpha channels.
