These original constant-color JPEG images were encoded with Pillow for the JPEG decoder tests. They cover grayscale/RGB baseline and progressive streams and EXIF orientation. `../jpeg_fixtures.py` regenerates the images and embedded Silk vectors from the repository root; Pillow/libjpeg versions may affect encoded bytes, so regeneration is intentional rather than part of the normal gate.

Header tests do not establish successful entropy decoding. Pixel-decoder tests will consume these same fixtures as that implementation is added.
