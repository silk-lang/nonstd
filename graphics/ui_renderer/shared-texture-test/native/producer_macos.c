/* The macOS producer: an IOSurface in BGRA, as WebKit and Chromium hand over, filled from RGBA
 * rows. The caller releases nothing; the test process exits after using it. */
#include <CoreFoundation/CoreFoundation.h>
#include <IOSurface/IOSurfaceRef.h>
#include <stdint.h>

static CFNumberRef number(int32_t value) {
    return CFNumberCreate(kCFAllocatorDefault, kCFNumberSInt32Type, &value);
}

void *silkProducerCreateIOSurface(uint32_t width, uint32_t height, const uint8_t *pixels) {
    const void *keys[] = {kIOSurfaceWidth, kIOSurfaceHeight, kIOSurfaceBytesPerElement, kIOSurfacePixelFormat};
    const void *values[] = {number((int32_t)width), number((int32_t)height), number(4), number(0x42475241 /* 'BGRA' */)};
    CFDictionaryRef properties = CFDictionaryCreate(kCFAllocatorDefault, keys, values, 4,
                                                    &kCFTypeDictionaryKeyCallBacks,
                                                    &kCFTypeDictionaryValueCallBacks);
    for (int i = 0; i < 4; i++) {
        CFRelease(values[i]);
    }
    IOSurfaceRef surface = IOSurfaceCreate(properties);
    CFRelease(properties);
    if (surface == NULL) {
        return NULL;
    }
    IOSurfaceLock(surface, 0, NULL);
    uint8_t *base = IOSurfaceGetBaseAddress(surface);
    size_t stride = IOSurfaceGetBytesPerRow(surface);
    for (uint32_t y = 0; y < height; y++) {
        for (uint32_t x = 0; x < width; x++) {
            const uint8_t *from = pixels + ((size_t)y * width + x) * 4;
            uint8_t *to = base + y * stride + (size_t)x * 4;
            to[0] = from[2];
            to[1] = from[1];
            to[2] = from[0];
            to[3] = from[3];
        }
    }
    IOSurfaceUnlock(surface, 0, NULL);
    return (void *)surface;
}
