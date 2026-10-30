These original constant-color JPEG images were encoded with Pillow for the JPEG decoder tests. They cover grayscale/RGB baseline and progressive streams and EXIF orientation. `../jpeg_fixtures.py` regenerates the five header fixtures and embedded Silk vectors from the repository root; Pillow/libjpeg versions may affect encoded bytes, so regeneration is intentional rather than part of the normal gate.

Header tests do not establish successful entropy decoding. Pixel-decoder tests will consume these same fixtures as that implementation is added.

`grayGradient.jpg` and `grayRestart.jpg` are additional original 17×9 grayscale pixel fixtures. The former exercises AC reconstruction; the latter has a restart interval of one MCU and five restart markers. Pixel expectations were obtained independently with Pillow; the tests allow one sample level for differing IDCT rounding.
