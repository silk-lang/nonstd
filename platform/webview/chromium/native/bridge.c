// The Chromium backend of platform/webview on Linux: CEF, rendering offscreen (C ABI in
// bridge.h).
//
// libcef.so is loaded at run time from the runtime directory the app names (scripts/install-cef
// puts one together), so programs build without CEF and report Unsupported when it is missing.
// CEF runs its browser process UI thread on the app's main thread with an external message pump:
// CEF says when it wants work (on_schedule_message_pump_work, from any thread), a timer thread
// wakes platform-window's nextEvent then, and the app's loop calls silk_cef_pump, which does the
// work. Every callback from CEF only records state or queues an event; nothing calls into Silk.
//
// Pages render offscreen. A view's frames arrive as CPU pixels (on_paint, BGRA) or, with shared
// textures, as dma-bufs (on_accelerated_paint); the bridge keeps the latest of each, and the Silk
// side uploads or imports them into the texture its hosted node draws (silk_cef_frame).
//
// Agent control and scripts use the Chrome DevTools Protocol through CEF's message API: the agent
// script runs in an isolated world of its own ("silk-agent"), which pages cannot see, and agent
// clicks, keys and wheel turns are Input.dispatch* events, which pages get as trusted input. A
// person's input, forwarded from the window, goes through CEF's own send_*_event calls.
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <math.h>
#include <pthread.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

#include "include/cef_api_hash.h"
#include "include/capi/cef_app_capi.h"
#include "include/capi/cef_browser_capi.h"
#include "include/capi/cef_browser_process_handler_capi.h"
#include "include/capi/cef_client_capi.h"
#include "include/capi/cef_command_line_capi.h"
#include "include/capi/cef_devtools_message_observer_capi.h"
#include "include/capi/cef_display_handler_capi.h"
#include "include/capi/cef_focus_handler_capi.h"
#include "include/capi/cef_frame_capi.h"
#include "include/capi/cef_life_span_handler_capi.h"
#include "include/capi/cef_load_handler_capi.h"
#include "include/capi/cef_registration_capi.h"
#include "include/capi/cef_render_handler_capi.h"
#include "include/capi/cef_request_capi.h"
#include "include/capi/cef_request_context_capi.h"
#include "include/capi/cef_request_handler_capi.h"
#include "bridge.h"
#include "keys.h"

// platform-window's bridge (platform/window/native/bridge.h). Weak, so this package's own unit
// tests link without platform-window; a program with web views has it for its windows.
void silk_window_wake(void) __attribute__((weak));

static void wake_window(void) {
    if (silk_window_wake) silk_window_wake();
}

static const char agentWorld[] = "silk-agent";
static const char agentMissing[] = "the agent script is not in this page";

// ---------------------------------------------------------------------------------------
// Strings and buffers.

typedef struct Buffer {
    char *data;
    size_t length;
    size_t capacity;
} Buffer;

static void buffer_reserve(Buffer *buffer, size_t extra) {
    if (buffer->length + extra + 1 <= buffer->capacity) return;
    size_t capacity = buffer->capacity ? buffer->capacity : 64;
    while (capacity < buffer->length + extra + 1) capacity *= 2;
    char *data = realloc(buffer->data, capacity);
    if (!data) abort();
    buffer->data = data;
    buffer->capacity = capacity;
}

static void buffer_add(Buffer *buffer, const char *text, size_t length) {
    buffer_reserve(buffer, length);
    if (length) memcpy(buffer->data + buffer->length, text, length);
    buffer->length += length;
    buffer->data[buffer->length] = 0;
}

static void buffer_text(Buffer *buffer, const char *text) { buffer_add(buffer, text, strlen(text)); }

static void buffer_format(Buffer *buffer, const char *format, double value) {
    char text[64];
    int length = snprintf(text, sizeof text, format, value);
    if (length > 0) buffer_add(buffer, text, (size_t)length);
}

// `text` as a JSON string literal.
static void buffer_json(Buffer *buffer, const char *text, size_t length) {
    buffer_add(buffer, "\"", 1);
    for (size_t i = 0; i < length; i++) {
        unsigned char c = (unsigned char)text[i];
        if (c == '"' || c == '\\') {
            char escaped[2] = {'\\', (char)c};
            buffer_add(buffer, escaped, 2);
        } else if (c < 0x20) {
            char escaped[8];
            snprintf(escaped, sizeof escaped, "\\u%04x", c);
            buffer_add(buffer, escaped, 6);
        } else {
            buffer_add(buffer, (const char *)&c, 1);
        }
    }
    buffer_add(buffer, "\"", 1);
}

static void buffer_free(Buffer *buffer) {
    free(buffer->data);
    buffer->data = NULL;
    buffer->length = buffer->capacity = 0;
}

static char *copy_bytes(const void *bytes, size_t length) {
    char *copy = malloc(length + 1);
    if (!copy) abort();
    if (length) memcpy(copy, bytes, length);
    copy[length] = 0;
    return copy;
}

// ---------------------------------------------------------------------------------------
// A small JSON reader for DevTools protocol answers (UTF-8, NUL-terminated).

static const char *json_space(const char *p) {
    while (p && (*p == ' ' || *p == '\n' || *p == '\r' || *p == '\t')) p++;
    return p;
}

static const char *json_after_string(const char *p) {
    p++;
    while (*p && *p != '"') {
        if (*p == '\\' && p[1]) p++;
        p++;
    }
    return *p ? p + 1 : p;
}

static const char *json_after(const char *p) {
    p = json_space(p);
    if (*p == '"') return json_after_string(p);
    if (*p == '{' || *p == '[') {
        int depth = 0;
        while (*p) {
            if (*p == '"') {
                p = json_after_string(p);
                continue;
            }
            if (*p == '{' || *p == '[') depth++;
            if (*p == '}' || *p == ']') {
                if (--depth == 0) return p + 1;
            }
            p++;
        }
        return p;
    }
    while (*p && *p != ',' && *p != '}' && *p != ']' && *p != ' ' && *p != '\n' && *p != '\r' &&
           *p != '\t')
        p++;
    return p;
}

// The value of member `key` of the object at `p`, or NULL.
static const char *json_member(const char *p, const char *key) {
    if (!p) return NULL;
    p = json_space(p);
    if (*p != '{') return NULL;
    p++;
    size_t keyLength = strlen(key);
    for (;;) {
        p = json_space(p);
        if (*p != '"') return NULL;
        const char *name = p + 1;
        const char *end = json_after_string(p);
        bool same = end > name && (size_t)(end - 1 - name) == keyLength &&
                    memcmp(name, key, keyLength) == 0;
        p = json_space(end);
        if (*p != ':') return NULL;
        p = json_space(p + 1);
        if (same) return p;
        p = json_space(json_after(p));
        if (*p != ',') return NULL;
        p++;
    }
}

static void put_utf8(Buffer *out, unsigned long code) {
    char bytes[4];
    size_t length;
    if (code < 0x80) {
        bytes[0] = (char)code;
        length = 1;
    } else if (code < 0x800) {
        bytes[0] = (char)(0xC0 | (code >> 6));
        bytes[1] = (char)(0x80 | (code & 0x3F));
        length = 2;
    } else if (code < 0x10000) {
        bytes[0] = (char)(0xE0 | (code >> 12));
        bytes[1] = (char)(0x80 | ((code >> 6) & 0x3F));
        bytes[2] = (char)(0x80 | (code & 0x3F));
        length = 3;
    } else {
        bytes[0] = (char)(0xF0 | (code >> 18));
        bytes[1] = (char)(0x80 | ((code >> 12) & 0x3F));
        bytes[2] = (char)(0x80 | ((code >> 6) & 0x3F));
        bytes[3] = (char)(0x80 | (code & 0x3F));
        length = 4;
    }
    buffer_add(out, bytes, length);
}

static unsigned long json_hex4(const char *p) {
    unsigned long value = 0;
    for (int i = 0; i < 4; i++) {
        char c = p[i];
        value <<= 4;
        if (c >= '0' && c <= '9') value |= (unsigned long)(c - '0');
        else if (c >= 'a' && c <= 'f') value |= (unsigned long)(c - 'a' + 10);
        else if (c >= 'A' && c <= 'F') value |= (unsigned long)(c - 'A' + 10);
        else return 0xFFFFFFFF;
    }
    return value;
}

// The JSON string at `p`, decoded (malloc'd UTF-8), or NULL when `p` is not a string.
static char *json_string(const char *p, size_t *length) {
    p = json_space(p);
    if (!p || *p != '"') return NULL;
    Buffer out = {0};
    buffer_reserve(&out, 0);
    p++;
    while (*p && *p != '"') {
        if (*p != '\\') {
            const char *start = p;
            while (*p && *p != '"' && *p != '\\') p++;
            buffer_add(&out, start, (size_t)(p - start));
            continue;
        }
        p++;
        char c = *p ? *p++ : 0;
        switch (c) {
        case 'n': buffer_add(&out, "\n", 1); break;
        case 'r': buffer_add(&out, "\r", 1); break;
        case 't': buffer_add(&out, "\t", 1); break;
        case 'b': buffer_add(&out, "\b", 1); break;
        case 'f': buffer_add(&out, "\f", 1); break;
        case 'u': {
            unsigned long code = strlen(p) >= 4 ? json_hex4(p) : 0xFFFFFFFF;
            if (code == 0xFFFFFFFF) break;
            p += 4;
            if (code >= 0xD800 && code < 0xDC00 && p[0] == '\\' && p[1] == 'u' && strlen(p) >= 6) {
                unsigned long low = json_hex4(p + 2);
                if (low >= 0xDC00 && low < 0xE000) {
                    code = 0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00);
                    p += 6;
                }
            }
            if (code >= 0xD800 && code < 0xE000) code = 0xFFFD;
            put_utf8(&out, code);
            break;
        }
        default:
            if (c) buffer_add(&out, &c, 1);
            break;
        }
    }
    if (length) *length = out.length;
    return out.data;
}

static double json_number(const char *p, double fallback) {
    p = json_space(p);
    if (!p || !((*p >= '0' && *p <= '9') || *p == '-')) return fallback;
    return strtod(p, NULL);
}

static bool json_true(const char *p) {
    p = json_space(p);
    return p && strncmp(p, "true", 4) == 0;
}

// ---------------------------------------------------------------------------------------
// The event queue.

typedef struct Text {
    char *bytes;
    size_t length;
} Text;

typedef struct Queued {
    SilkCefEvent event;
    Text texts[2];
} Queued;

static Queued *queue;
static size_t queueHead, queueCount, queueCapacity;
static Text currentTexts[2];

static SilkCefEvent blank(uint32_t kind, uint32_t view) {
    SilkCefEvent event;
    memset(&event, 0, sizeof event);
    event.kind = kind;
    event.view = view;
    return event;
}

// Queues `event` with up to two strings (copied) and wakes the window's loop.
static void push_texts(SilkCefEvent event, const char *first, size_t firstLength,
                       const char *second, size_t secondLength, uint32_t count) {
    if (queueHead + queueCount == queueCapacity) {
        if (queueHead > 0) {
            memmove(queue, queue + queueHead, queueCount * sizeof *queue);
            queueHead = 0;
        } else {
            size_t capacity = queueCapacity ? queueCapacity * 2 : 32;
            Queued *grown = realloc(queue, capacity * sizeof *queue);
            if (!grown) abort();
            queue = grown;
            queueCapacity = capacity;
        }
    }
    Queued *queued = &queue[queueHead + queueCount++];
    memset(queued, 0, sizeof *queued);
    queued->event = event;
    queued->event.count = count;
    if (count > 0) queued->texts[0] = (Text){copy_bytes(first ? first : "", firstLength), firstLength};
    if (count > 1) queued->texts[1] = (Text){copy_bytes(second ? second : "", secondLength), secondLength};
    wake_window();
}

static void push(SilkCefEvent event) { push_texts(event, NULL, 0, NULL, 0, 0); }

static void push_text(uint32_t kind, uint32_t view, const char *text) {
    push_texts(blank(kind, view), text, text ? strlen(text) : 0, NULL, 0, 1);
}

static void push_answer(uint32_t kind, uint32_t view, uint32_t request, bool ok, const char *text) {
    SilkCefEvent event = blank(kind, view);
    event.request = request;
    if (ok) event.flags |= SILK_CEF_FLAG_OK;
    push_texts(event, text, text ? strlen(text) : 0, NULL, 0, 1);
}

static void push_progress(uint32_t view, double fraction) {
    SilkCefEvent event = blank(SILK_CEF_LOAD_PROGRESS, view);
    event.value = fraction;
    push(event);
}

uint8_t silk_cef_next_event(SilkCefEvent *out) {
    for (int i = 0; i < 2; i++) {
        free(currentTexts[i].bytes);
        currentTexts[i] = (Text){NULL, 0};
    }
    if (queueCount == 0) return 0;
    Queued *queued = &queue[queueHead];
    *out = queued->event;
    currentTexts[0] = queued->texts[0];
    currentTexts[1] = queued->texts[1];
    queueHead++;
    queueCount--;
    if (queueCount == 0) queueHead = 0;
    return 1;
}

const uint8_t *silk_cef_event_text(size_t index, size_t *length) {
    if (index >= 2 || !currentTexts[index].bytes) {
        *length = 0;
        return NULL;
    }
    *length = currentTexts[index].length;
    return (const uint8_t *)currentTexts[index].bytes;
}

void silk_cef_queue(uint32_t view, uint32_t kind, uint32_t request, uint32_t flags,
                        const uint8_t *text, size_t length) {
    SilkCefEvent event = blank(kind, view);
    event.request = request;
    event.flags = flags;
    push_texts(event, (const char *)text, text ? length : 0, NULL, 0, 1);
}

// ---------------------------------------------------------------------------------------
// libcef.so, loaded at run time.

#define CEF_FUNCTIONS(X)                   \
    X(cef_api_hash)                        \
    X(cef_initialize)                      \
    X(cef_shutdown)                        \
    X(cef_do_message_loop_work)            \
    X(cef_browser_host_create_browser)     \
    X(cef_request_context_create_context)  \
    X(cef_string_utf8_to_utf16)            \
    X(cef_string_utf16_to_utf8)            \
    X(cef_string_utf16_clear)              \
    X(cef_string_utf8_clear)               \
    X(cef_string_userfree_utf16_free)

static struct {
#define DECLARE(name) __typeof__(name) *name;
    CEF_FUNCTIONS(DECLARE)
#undef DECLARE
} cef;

static void *library;
static bool started, contextReady, shuttingDown;
static uint32_t startFlags;
static char *agentScript;
static size_t agentScriptLength;
static char *cacheRoot;
static char lastError[512];

static void set_error(const char *format, const char *detail) {
    snprintf(lastError, sizeof lastError, format, detail ? detail : "");
}

const char *silk_cef_error(void) { return lastError; }

// A CEF string holding `text` (UTF-8); clear it with clear_string.
static cef_string_t make_string(const char *text, size_t length) {
    cef_string_t out;
    memset(&out, 0, sizeof out);
    if (length) cef.cef_string_utf8_to_utf16(text, length, &out);
    return out;
}

static void clear_string(cef_string_t *text) { cef.cef_string_utf16_clear(text); }

// `text` as malloc'd UTF-8 (never NULL).
static char *utf8_of(const cef_string_t *text, size_t *length) {
    if (!text || !text->str || text->length == 0) {
        if (length) *length = 0;
        return copy_bytes("", 0);
    }
    cef_string_utf8_t out;
    memset(&out, 0, sizeof out);
    cef.cef_string_utf16_to_utf8(text->str, text->length, &out);
    char *copy = copy_bytes(out.str ? out.str : "", out.str ? out.length : 0);
    if (length) *length = out.str ? out.length : 0;
    cef.cef_string_utf8_clear(&out);
    return copy;
}

// A string CEF allocated for us, as UTF-8, freeing it.
static char *take_string(cef_string_userfree_t text) {
    char *out = utf8_of(text, NULL);
    if (text) cef.cef_string_userfree_utf16_free(text);
    return out;
}

static void release(void *object) {
    if (!object) return;
    cef_base_ref_counted_t *base = object;
    base->release(base);
}

// Reference counting of the bridge's own handler objects: they live as long as the process.
static void CEF_CALLBACK static_add_ref(cef_base_ref_counted_t *self) {}
static int CEF_CALLBACK static_release(cef_base_ref_counted_t *self) { return 0; }
static int CEF_CALLBACK static_has_one_ref(cef_base_ref_counted_t *self) { return 1; }
static int CEF_CALLBACK static_has_at_least_one_ref(cef_base_ref_counted_t *self) { return 1; }

static void init_base(cef_base_ref_counted_t *base, size_t size) {
    base->size = size;
    base->add_ref = static_add_ref;
    base->release = static_release;
    base->has_one_ref = static_has_one_ref;
    base->has_at_least_one_ref = static_has_at_least_one_ref;
}

static double now_seconds(void) {
    struct timespec time;
    clock_gettime(CLOCK_MONOTONIC, &time);
    return (double)time.tv_sec + (double)time.tv_nsec / 1e9;
}

// ---------------------------------------------------------------------------------------
// Base64, for screenshots (PNG in the protocol's answers) and LoadHtml bodies.

static const char base64Digits[] =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

static void buffer_base64(Buffer *out, const uint8_t *bytes, size_t length) {
    for (size_t i = 0; i < length; i += 3) {
        uint32_t chunk = (uint32_t)bytes[i] << 16;
        if (i + 1 < length) chunk |= (uint32_t)bytes[i + 1] << 8;
        if (i + 2 < length) chunk |= bytes[i + 2];
        char quad[4] = {base64Digits[(chunk >> 18) & 63], base64Digits[(chunk >> 12) & 63],
                        i + 1 < length ? base64Digits[(chunk >> 6) & 63] : '=',
                        i + 2 < length ? base64Digits[chunk & 63] : '='};
        buffer_add(out, quad, 4);
    }
}

static int base64_value(char c) {
    if (c >= 'A' && c <= 'Z') return c - 'A';
    if (c >= 'a' && c <= 'z') return c - 'a' + 26;
    if (c >= '0' && c <= '9') return c - '0' + 52;
    if (c == '+') return 62;
    if (c == '/') return 63;
    return -1;
}

// Decodes base64 `text` into malloc'd bytes.
static uint8_t *decode_base64(const char *text, size_t textLength, size_t *length) {
    uint8_t *out = malloc(textLength / 4 * 3 + 3);
    if (!out) abort();
    size_t count = 0;
    uint32_t chunk = 0;
    int bits = 0;
    for (size_t i = 0; i < textLength; i++) {
        int value = base64_value(text[i]);
        if (value < 0) continue;
        chunk = (chunk << 6) | (uint32_t)value;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out[count++] = (uint8_t)(chunk >> bits);
        }
    }
    *length = count;
    return out;
}

// ---------------------------------------------------------------------------------------
// Views.

enum { STARTING, READY, CLOSING };

typedef enum OpKind {
    OP_NAVIGATE,
    OP_LOAD_HTML,
    OP_GO,
    OP_ZOOM,
    OP_FOCUS,
    OP_EVALUATE,
    OP_AGENT,
    OP_SCREENSHOT,
    OP_CLICK,
    OP_MOVE,
    OP_SCROLL,
    OP_TYPE,
    OP_KEY,
    OP_DEVTOOLS,
} OpKind;

// A command waiting for its view to start.
typedef struct Op {
    OpKind kind;
    uint32_t request, a, b, c;
    double x, y, dx, dy;
    char *first, *second; // owned
    size_t firstLength, secondLength;
} Op;

typedef struct Decision {
    uint32_t request;
    char *url;
} Decision;

typedef struct Frame {
    uint32_t kind;
    uint32_t width, height;
    uint64_t generation;
    uint8_t *pixels;
    size_t capacity;
    uint32_t drmFormat, planeCount;
    uint64_t drmModifier;
    SilkCefPlane planes[4];
} Frame;

// The per-view client: CEF hands it back through the browser host, which is how a new browser
// finds its view.
typedef struct ViewClient {
    cef_client_t client;
    uint64_t serial;
} ViewClient;

typedef struct View {
    uint32_t id;
    uint64_t serial;
    int state;
    uint32_t flags;
    ViewClient *client;
    cef_browser_t *browser;
    cef_browser_host_t *host;
    int browserId;
    cef_registration_t *observer;
    char *url; // the first page, loaded once the agent script is in
    Op *ops;
    size_t opCount, opCapacity;
    // The last placement, in points.
    bool placed, shows;
    double x0, y0, x1, y1, scale;
    bool focused;
    bool canGoBack, canGoForward;
    bool skipNextAsk;
    uint32_t nextRequest;
    Decision *decisions;
    size_t decisionCount, decisionCapacity;
    uint32_t cursor;
    // The composition's character bounds, in CSS pixels of the view.
    bool hasCaret;
    double caretX, caretY, caretWidth, caretHeight;
    bool composing;
    Frame frame, popup;
    bool popupShown;
    int popupX, popupY, popupWidth, popupHeight; // in CSS pixels
    // LoadHtml with a base URL: served from Fetch.requestPaused.
    char *html;
    size_t htmlLength;
    bool fetching;
} View;

static View **views;
static size_t viewCount, viewCapacity;
static uint64_t nextSerial = 1;

static View *find_view(uint32_t id) {
    for (size_t i = 0; i < viewCount; i++)
        if (views[i]->id == id) return views[i];
    return NULL;
}

static View *find_serial(uint64_t serial) {
    for (size_t i = 0; i < viewCount; i++)
        if (views[i]->serial == serial) return views[i];
    return NULL;
}

// The view showing `browser`; releases the caller's reference to it.
static View *view_of(cef_browser_t *browser) {
    if (!browser) return NULL;
    int id = browser->get_identifier(browser);
    release(browser);
    for (size_t i = 0; i < viewCount; i++)
        if (views[i]->browser && views[i]->browserId == id) return views[i];
    return NULL;
}

static void free_op(Op *op) {
    free(op->first);
    free(op->second);
    op->first = op->second = NULL;
}

static void close_frame(Frame *frame) {
    for (uint32_t i = 0; i < frame->planeCount; i++) {
        if (frame->planes[i].fd >= 0) close(frame->planes[i].fd);
        frame->planes[i].fd = -1;
    }
    frame->planeCount = 0;
}

static void free_view(View *view) {
    for (size_t i = 0; i < view->opCount; i++) free_op(&view->ops[i]);
    free(view->ops);
    for (size_t i = 0; i < view->decisionCount; i++) free(view->decisions[i].url);
    free(view->decisions);
    close_frame(&view->frame);
    close_frame(&view->popup);
    free(view->frame.pixels);
    free(view->popup.pixels);
    free(view->url);
    free(view->html);
    free(view);
}

static void remove_view(View *view) {
    for (size_t i = 0; i < viewCount; i++) {
        if (views[i] == view) {
            memmove(&views[i], &views[i + 1], (viewCount - i - 1) * sizeof *views);
            viewCount--;
            break;
        }
    }
    free_view(view);
}

static void set_focused(View *view, bool focused) {
    if (view->focused == focused) return;
    view->focused = focused;
    SilkCefEvent event = blank(SILK_CEF_FOCUS_CHANGED, view->id);
    if (focused) event.flags |= SILK_CEF_FLAG_OK;
    push(event);
}

// ---------------------------------------------------------------------------------------
// The DevTools protocol, through cef_browser_host_t's message API.

typedef enum CdpKind {
    CDP_IGNORE,
    CDP_SETUP,      // the agent script was added: the view is ready
    CDP_EVALUATE,   // Runtime.evaluate for Command.Evaluate
    CDP_AGENT,      // a step of an agent command
    CDP_ACTION,     // the last input of an agent action went through
    CDP_SCREENSHOT, // Page.captureScreenshot
    CDP_FETCH_ON,   // Fetch.enable for LoadHtml: navigate to the base URL next
} CdpKind;

typedef struct Pending {
    int id;
    uint64_t serial;
    CdpKind kind;
    uint32_t request;
    uint32_t operation;
    uint32_t step;
    char *call; // owned
    char *text; // owned
    size_t textLength;
    double context; // an execution context id
    bool injected;  // the agent script was injected into that context
} Pending;

static Pending *pendings;
static size_t pendingCount, pendingCapacity;
static int nextMessage = 1;

static Pending *pending(CdpKind kind, View *view) {
    Pending *made = calloc(1, sizeof *made);
    if (!made) abort();
    made->kind = kind;
    made->serial = view->serial;
    return made;
}

static void free_pending(Pending *done) {
    if (!done) return;
    free(done->call);
    free(done->text);
    free(done);
}

static void cdp_answered(Pending *done, bool ok, const char *json);

// Sends `method` with `params` (a JSON object, NULL for none); `done` (owned, may be NULL) gets
// the answer.
static void cdp(View *view, const char *method, const char *params, Pending *done) {
    if (!view->host) {
        free_pending(done);
        return;
    }
    int id = nextMessage++;
    Buffer message = {0};
    buffer_format(&message, "{\"id\":%.0f,\"method\":", id);
    buffer_json(&message, method, strlen(method));
    buffer_text(&message, ",\"params\":");
    buffer_text(&message, params ? params : "{}");
    buffer_text(&message, "}");
    if (done) {
        done->id = id;
        if (pendingCount == pendingCapacity) {
            size_t capacity = pendingCapacity ? pendingCapacity * 2 : 16;
            Pending *grown = realloc(pendings, capacity * sizeof *grown);
            if (!grown) abort();
            pendings = grown;
            pendingCapacity = capacity;
        }
        pendings[pendingCount++] = *done;
        free(done);
    }
    int sent = view->host->send_dev_tools_message(view->host, message.data, message.length);
    buffer_free(&message);
    if (!sent && done) {
        // Answer at once, as a failure.
        for (size_t i = 0; i < pendingCount; i++) {
            if (pendings[i].id == id) {
                Pending copy = pendings[i];
                memmove(&pendings[i], &pendings[i + 1], (pendingCount - i - 1) * sizeof *pendings);
                pendingCount--;
                Pending *owned = malloc(sizeof *owned);
                if (!owned) abort();
                *owned = copy;
                cdp_answered(owned, false, "{\"message\":\"the DevTools protocol is not available\"}");
                break;
            }
        }
    }
}

static Pending *cdp_answer(CdpKind kind, View *view) { return pending(kind, view); }

// The protocol's error message in an answer, or a generic one.
static char *cdp_error(const char *json) {
    const char *message = json ? json_member(json, "message") : NULL;
    char *text = message ? json_string(message, NULL) : NULL;
    if (text) return text;
    return copy_bytes("DevTools protocol call failed", 29);
}

// The answer of Runtime.evaluate: the string value, or NULL with *error set.
static char *evaluated_string(bool ok, const char *json, char **error) {
    *error = NULL;
    if (!ok || !json) {
        *error = cdp_error(json);
        return NULL;
    }
    const char *exception = json_member(json, "exceptionDetails");
    if (exception) {
        const char *thrown = json_member(exception, "exception");
        char *description = thrown ? json_string(json_member(thrown, "description"), NULL) : NULL;
        if (!description) description = json_string(json_member(exception, "text"), NULL);
        if (!description) description = copy_bytes("the script threw", 16);
        // The first line: the message without the stack.
        char *newline = strchr(description, '\n');
        if (newline) *newline = 0;
        *error = description;
        return NULL;
    }
    char *value = json_string(json_member(json_member(json, "result"), "value"), NULL);
    if (!value) *error = copy_bytes("the script gave no string", 25);
    return value;
}

// ---------------------------------------------------------------------------------------
// Agent input through the DevTools protocol.

static int cdp_modifiers(uint32_t bits) {
    int flags = 0;
    if (bits & 4) flags |= 1; // Alt
    if (bits & 2) flags |= 2; // Control
    if (bits & 8) flags |= 4; // Meta
    if (bits & 1) flags |= 8; // Shift
    return flags;
}

static void mouse(View *view, const char *type, double x, double y, uint32_t button, int clicks,
                  uint32_t modifiers, double dx, double dy, Pending *done) {
    static const char *const buttons[] = {"left", "middle", "right"};
    Buffer params = {0};
    buffer_text(&params, "{\"type\":\"");
    buffer_text(&params, type);
    buffer_text(&params, "\"");
    buffer_format(&params, ",\"x\":%.2f", x);
    buffer_format(&params, ",\"y\":%.2f", y);
    buffer_format(&params, ",\"modifiers\":%.0f", cdp_modifiers(modifiers));
    if (strcmp(type, "mouseWheel") == 0) {
        buffer_format(&params, ",\"deltaX\":%.2f", dx);
        buffer_format(&params, ",\"deltaY\":%.2f", dy);
    } else if (clicks > 0) {
        buffer_text(&params, ",\"button\":\"");
        buffer_text(&params, buttons[button < 3 ? button : 0]);
        buffer_text(&params, "\"");
        buffer_format(&params, ",\"clickCount\":%.0f", clicks);
    }
    buffer_text(&params, "}");
    cdp(view, "Input.dispatchMouseEvent", params.data, done);
    buffer_free(&params);
}

static void click(View *view, double x, double y, uint32_t button, uint32_t clickCount,
                  uint32_t modifiers, Pending *done) {
    int clicks = clickCount < 1 ? 1 : (int)clickCount;
    mouse(view, "mouseMoved", x, y, 0, 0, modifiers, 0, 0, NULL);
    for (int i = 1; i <= clicks; i++) {
        mouse(view, "mousePressed", x, y, button, i, modifiers, 0, 0, NULL);
        mouse(view, "mouseReleased", x, y, button, i, modifiers, 0, 0, i == clicks ? done : NULL);
    }
}

typedef struct KeyInfo {
    const char *key;
    const char *code;
    int virtualKey;
    const char *text;
} KeyInfo;

static const KeyInfo namedKeys[] = {
    {"Enter", "Enter", 13, "\r"},         {"Tab", "Tab", 9, NULL},
    {"Backspace", "Backspace", 8, NULL},  {"Escape", "Escape", 27, NULL},
    {"Delete", "Delete", 46, NULL},       {"Home", "Home", 36, NULL},
    {"End", "End", 35, NULL},             {"PageUp", "PageUp", 33, NULL},
    {"PageDown", "PageDown", 34, NULL},   {"ArrowLeft", "ArrowLeft", 37, NULL},
    {"ArrowUp", "ArrowUp", 38, NULL},     {"ArrowRight", "ArrowRight", 39, NULL},
    {"ArrowDown", "ArrowDown", 40, NULL}, {"F1", "F1", 112, NULL},
    {"F2", "F2", 113, NULL},              {"F3", "F3", 114, NULL},
    {"F4", "F4", 115, NULL},              {"F5", "F5", 116, NULL},
    {"F6", "F6", 117, NULL},              {"F7", "F7", 118, NULL},
    {"F8", "F8", 119, NULL},              {"F9", "F9", 120, NULL},
    {"F10", "F10", 121, NULL},            {"F11", "F11", 122, NULL},
    {"F12", "F12", 123, NULL},
};

static const KeyInfo *named_key(const char *name, size_t length) {
    for (size_t i = 0; i < sizeof namedKeys / sizeof namedKeys[0]; i++) {
        if (strlen(namedKeys[i].key) == length && memcmp(namedKeys[i].key, name, length) == 0)
            return &namedKeys[i];
    }
    return NULL;
}

// The length of the UTF-8 sequence starting with `lead`.
static size_t utf8_length(unsigned char lead) {
    if (lead < 0x80) return 1;
    if ((lead & 0xE0) == 0xC0) return 2;
    if ((lead & 0xF0) == 0xE0) return 3;
    if ((lead & 0xF8) == 0xF0) return 4;
    return 1;
}

// One key down and up. `text` (may be NULL) is what the press types.
static void key(View *view, const char *name, size_t nameLength, const char *code, int virtualKey,
                const char *text, size_t textLength, uint32_t modifiers, Pending *done) {
    for (int up = 0; up < 2; up++) {
        Buffer params = {0};
        buffer_text(&params, "{\"type\":\"");
        buffer_text(&params, up ? "keyUp" : text ? "keyDown" : "rawKeyDown");
        buffer_text(&params, "\",\"key\":");
        buffer_json(&params, name, nameLength);
        if (code) {
            buffer_text(&params, ",\"code\":");
            buffer_json(&params, code, strlen(code));
        }
        buffer_format(&params, ",\"windowsVirtualKeyCode\":%.0f", virtualKey);
        buffer_format(&params, ",\"modifiers\":%.0f", cdp_modifiers(modifiers));
        if (text && !up) {
            buffer_text(&params, ",\"text\":");
            buffer_json(&params, text, textLength);
            buffer_text(&params, ",\"unmodifiedText\":");
            buffer_json(&params, text, textLength);
        }
        buffer_text(&params, "}");
        cdp(view, "Input.dispatchKeyEvent", params.data, up ? done : NULL);
        buffer_free(&params);
    }
}

static void press_character(View *view, const char *character, size_t length, uint32_t modifiers,
                            Pending *done) {
    char c = length == 1 ? character[0] : 0;
    int virtualKey = 0;
    char code[16] = {0};
    if (c >= 'a' && c <= 'z') {
        virtualKey = c - 'a' + 'A';
        snprintf(code, sizeof code, "Key%c", c - 'a' + 'A');
    } else if (c >= 'A' && c <= 'Z') {
        virtualKey = c;
        snprintf(code, sizeof code, "Key%c", c);
    } else if (c >= '0' && c <= '9') {
        virtualKey = c;
        snprintf(code, sizeof code, "Digit%c", c);
    } else if (c == ' ') {
        virtualKey = ' ';
        snprintf(code, sizeof code, "Space");
    }
    // With Control, Alt or Meta held the press is a shortcut and types nothing.
    bool types = (modifiers & ~1u) == 0;
    if (virtualKey == 0 && types) {
        // Not a key of a US layout: text input, as an input method gives it.
        Buffer params = {0};
        buffer_text(&params, "{\"text\":");
        buffer_json(&params, character, length);
        buffer_text(&params, "}");
        cdp(view, "Input.insertText", params.data, done);
        buffer_free(&params);
        return;
    }
    key(view, character, length, code[0] ? code : NULL, virtualKey, types ? character : NULL,
        length, modifiers, done);
}

static void type_text(View *view, const char *text, size_t length, Pending *done) {
    size_t i = 0;
    if (length == 0) {
        // Nothing to type: answer once earlier input has been handled.
        cdp(view, "Runtime.evaluate", "{\"expression\":\"0\"}", done);
        return;
    }
    while (i < length) {
        size_t step = utf8_length((unsigned char)text[i]);
        if (i + step > length) step = length - i;
        bool last = i + step >= length;
        Pending *then = last ? done : NULL;
        if (text[i] == '\n' || text[i] == '\r') {
            key(view, "Enter", 5, "Enter", 13, "\r", 1, 0, then);
        } else if (text[i] == '\t') {
            key(view, "Tab", 3, "Tab", 9, NULL, 0, 0, then);
        } else {
            press_character(view, text + i, step, 0, then);
        }
        i += step;
    }
}

// Whether `name` names a key PressKey can press: a named key or one character.
static bool known_key(const char *name, size_t length) {
    if (named_key(name, length)) return true;
    return length > 0 && utf8_length((unsigned char)name[0]) == length;
}

static void press_key(View *view, const char *name, size_t length, uint32_t modifiers,
                      Pending *done) {
    const KeyInfo *info = named_key(name, length);
    if (info) {
        key(view, info->key, strlen(info->key), info->code, info->virtualKey,
            (modifiers & ~1u) == 0 ? info->text : NULL, info->text ? strlen(info->text) : 0,
            modifiers, done);
        return;
    }
    if ((modifiers & 1) && length == 1 && name[0] >= 'a' && name[0] <= 'z') {
        char upper = (char)(name[0] - 'a' + 'A');
        press_character(view, &upper, 1, modifiers, done);
        return;
    }
    press_character(view, name, length, modifiers, done);
}

static void take_keyboard(View *view) {
    if (!view->host) return;
    view->host->set_focus(view->host, 1);
    set_focused(view, true);
}

// ---------------------------------------------------------------------------------------
// Agent control: evaluate agent.silk's call in the agent's isolated world, then click or type
// at the place it returns.

enum {
    AGENT_FRAME = 0,    // asked for the frame tree
    AGENT_WORLD = 1,    // asked for the isolated world of the main frame
    AGENT_CALL = 2,     // evaluated the call there
    AGENT_INJECTED = 3, // injected the agent script into a world that lacked it
};

static void agent_fail(View *view, Pending *self, const char *reason) {
    if (self->operation == SILK_CEF_AGENT_SNAPSHOT) {
        SilkCefEvent event = blank(SILK_CEF_SNAPSHOT, view->id);
        event.request = self->request;
        push_texts(event, "", 0, NULL, 0, 1);
    } else {
        push_answer(SILK_CEF_ACTION_RESULT, view->id, self->request, false, reason);
    }
}

static Pending *agent_next(Pending *self, View *view, uint32_t step) {
    Pending *next = cdp_answer(CDP_AGENT, view);
    next->request = self->request;
    next->operation = self->operation;
    next->step = step;
    next->call = self->call ? copy_bytes(self->call, strlen(self->call)) : NULL;
    next->text = self->text ? copy_bytes(self->text, self->textLength) : NULL;
    next->textLength = self->textLength;
    next->context = self->context;
    next->injected = self->injected;
    return next;
}

static void agent_evaluate(View *view, Pending *self, const char *expression, size_t length,
                           uint32_t step) {
    Buffer params = {0};
    buffer_text(&params, "{\"expression\":");
    buffer_json(&params, expression, length);
    buffer_format(&params, ",\"contextId\":%.0f", self->context);
    buffer_text(&params, ",\"returnByValue\":true,\"awaitPromise\":true}");
    cdp(view, "Runtime.evaluate", params.data, agent_next(self, view, step));
    buffer_free(&params);
}

// `value` is the call's JSON text: the outline as a JSON string, or a location object.
static void agent_act(View *view, Pending *self, const char *value) {
    if (self->operation == SILK_CEF_AGENT_SNAPSHOT) {
        size_t length = 0;
        char *outline = json_string(value, &length);
        SilkCefEvent event = blank(SILK_CEF_SNAPSHOT, view->id);
        event.request = self->request;
        push_texts(event, outline ? outline : "", outline ? length : 0, NULL, 0, 1);
        free(outline);
        return;
    }
    if (!json_true(json_member(value, "ok"))) {
        char *error = json_string(json_member(value, "error"), NULL);
        agent_fail(view, self, error ? error : "the element was not found");
        free(error);
        return;
    }
    double x = json_number(json_member(value, "x"), 0);
    double y = json_number(json_member(value, "y"), 0);
    Pending *done = cdp_answer(CDP_ACTION, view);
    done->request = self->request;
    // A click into the page gives it keyboard focus, as a person's click does.
    take_keyboard(view);
    if (self->operation == SILK_CEF_AGENT_CLICK) {
        click(view, x, y, 0, 1, 0, done);
    } else if (self->textLength) {
        type_text(view, self->text, self->textLength, done);
    } else {
        press_key(view, "Delete", 6, 0, done);
    }
}

static void agent_step(View *view, Pending *self, bool ok, const char *json) {
    if (!ok && self->step != AGENT_INJECTED) {
        char *error = cdp_error(json);
        agent_fail(view, self, error);
        free(error);
        return;
    }
    switch (self->step) {
    case AGENT_FRAME: {
        size_t length = 0;
        const char *frame = json_member(json_member(json, "frameTree"), "frame");
        char *id = json_string(json_member(frame, "id"), &length);
        if (!id) {
            agent_fail(view, self, "the page has no main frame");
            break;
        }
        Buffer params = {0};
        buffer_text(&params, "{\"frameId\":");
        buffer_json(&params, id, length);
        buffer_text(&params, ",\"worldName\":");
        buffer_json(&params, agentWorld, strlen(agentWorld));
        buffer_text(&params, "}");
        cdp(view, "Page.createIsolatedWorld", params.data, agent_next(self, view, AGENT_WORLD));
        buffer_free(&params);
        free(id);
        break;
    }
    case AGENT_WORLD: {
        // The same world the script was added to at document start: the protocol keeps one
        // isolated world per frame and name.
        self->context = json_number(json_member(json, "executionContextId"), -1);
        if (self->context < 0) {
            agent_fail(view, self, "no script world for the agent");
            break;
        }
        agent_evaluate(view, self, self->call, strlen(self->call), AGENT_CALL);
        break;
    }
    case AGENT_INJECTED:
        agent_evaluate(view, self, self->call, strlen(self->call), AGENT_CALL);
        break;
    case AGENT_CALL: {
        char *error = NULL;
        char *value = evaluated_string(ok, json, &error);
        if (!value) {
            agent_fail(view, self, error);
            free(error);
            break;
        }
        bool missing = (self->operation == SILK_CEF_AGENT_SNAPSHOT && strcmp(value, "null") == 0) ||
                       strstr(value, agentMissing) != NULL;
        if (missing && !self->injected && agentScript) {
            // A document that started before the script was added (or a world the protocol made
            // anew): put the agent there now, then call again.
            self->injected = true;
            agent_evaluate(view, self, agentScript, agentScriptLength, AGENT_INJECTED);
        } else if (missing) {
            agent_fail(view, self, agentMissing);
        } else {
            agent_act(view, self, value);
        }
        free(value);
        break;
    }
    default:
        break;
    }
}

static void run_agent(View *view, uint32_t request, uint32_t operation, const char *call,
                      const char *text, size_t textLength) {
    Pending *start = cdp_answer(CDP_AGENT, view);
    start->request = request;
    start->operation = operation;
    start->step = AGENT_FRAME;
    start->call = copy_bytes(call, strlen(call));
    start->text = text ? copy_bytes(text, textLength) : NULL;
    start->textLength = textLength;
    cdp(view, "Page.getFrameTree", NULL, start);
}

// ---------------------------------------------------------------------------------------
// Scripts in the page's own world, screenshots, and LoadHtml.

static void run_evaluate(View *view, uint32_t request, const char *script, size_t length) {
    // Indirect eval gives the script's completion value in global scope, as a console does; the
    // async function awaits a promise. Turned into JSON in the page, so values the protocol
    // cannot hand back (DOM nodes, functions) still answer.
    Buffer expression = {0};
    buffer_text(&expression, "(async () => { const value = await (0, eval)(");
    buffer_json(&expression, script, length);
    buffer_text(&expression, "); const json = value === undefined ? undefined : JSON.stringify(value); "
                             "return json === undefined ? 'null' : json; })()");
    Buffer params = {0};
    buffer_text(&params, "{\"expression\":");
    buffer_json(&params, expression.data, expression.length);
    buffer_text(&params, ",\"returnByValue\":true,\"awaitPromise\":true}");
    Pending *done = cdp_answer(CDP_EVALUATE, view);
    done->request = request;
    cdp(view, "Runtime.evaluate", params.data, done);
    buffer_free(&expression);
    buffer_free(&params);
}

static void run_screenshot(View *view, uint32_t request) {
    Pending *done = cdp_answer(CDP_SCREENSHOT, view);
    done->request = request;
    cdp(view, "Page.captureScreenshot", "{\"format\":\"png\"}", done);
}

static void load_url(View *view, const char *url, size_t length) {
    if (!view->browser) return;
    cef_frame_t *frame = view->browser->get_main_frame(view->browser);
    if (!frame) return;
    cef_string_t text = make_string(url, length);
    frame->load_url(frame, &text);
    clear_string(&text);
    release(frame);
}

// `text` with the Fetch domain's URL pattern wildcards (`*`, `?`) and backslashes escaped.
static void buffer_pattern(Buffer *out, const char *text, size_t length) {
    Buffer escaped = {0};
    buffer_reserve(&escaped, 0);
    for (size_t i = 0; i < length; i++) {
        if (text[i] == '*' || text[i] == '?' || text[i] == '\\') buffer_add(&escaped, "\\", 1);
        buffer_add(&escaped, &text[i], 1);
    }
    buffer_json(out, escaped.data, escaped.length);
    buffer_free(&escaped);
}

static void run_load_html(View *view, const char *html, size_t htmlLength, const char *base,
                          size_t baseLength) {
    view->skipNextAsk = true;
    if (baseLength == 0) {
        Buffer url = {0};
        buffer_text(&url, "data:text/html;charset=utf-8;base64,");
        buffer_base64(&url, (const uint8_t *)html, htmlLength);
        load_url(view, url.data, url.length);
        buffer_free(&url);
        return;
    }
    // CEF has no "load this HTML as that URL": intercept the base URL's document request with the
    // Fetch domain and answer it with the HTML (see the Fetch.requestPaused event).
    free(view->html);
    view->html = copy_bytes(html, htmlLength);
    view->htmlLength = htmlLength;
    Buffer params = {0};
    buffer_text(&params, "{\"patterns\":[{\"urlPattern\":");
    buffer_pattern(&params, base, baseLength);
    buffer_text(&params, ",\"resourceType\":\"Document\",\"requestStage\":\"Request\"}]}");
    Pending *done = cdp_answer(CDP_FETCH_ON, view);
    done->text = copy_bytes(base, baseLength);
    done->textLength = baseLength;
    cdp(view, "Fetch.enable", params.data, done);
    buffer_free(&params);
}

static void fetch_paused(View *view, const char *params) {
    size_t idLength = 0;
    char *requestId = json_string(json_member(params, "requestId"), &idLength);
    if (!requestId) return;
    Buffer answer = {0};
    buffer_text(&answer, "{\"requestId\":");
    buffer_json(&answer, requestId, idLength);
    if (view->html) {
        buffer_text(&answer, ",\"responseCode\":200,\"responseHeaders\":[{\"name\":\"Content-Type\","
                             "\"value\":\"text/html; charset=utf-8\"}],\"body\":\"");
        buffer_base64(&answer, (const uint8_t *)view->html, view->htmlLength);
        buffer_text(&answer, "\"}");
        cdp(view, "Fetch.fulfillRequest", answer.data, NULL);
        free(view->html);
        view->html = NULL;
        view->htmlLength = 0;
        cdp(view, "Fetch.disable", NULL, NULL);
        view->fetching = false;
    } else {
        buffer_text(&answer, "}");
        cdp(view, "Fetch.continueRequest", answer.data, NULL);
    }
    buffer_free(&answer);
    free(requestId);
}

static void ready(View *view);

static void cdp_answered(Pending *done, bool ok, const char *json) {
    View *view = find_serial(done->serial);
    if (!view) {
        free_pending(done);
        return;
    }
    switch (done->kind) {
    case CDP_SETUP:
        ready(view);
        break;
    case CDP_EVALUATE: {
        char *error = NULL;
        char *value = evaluated_string(ok, json, &error);
        push_answer(SILK_CEF_SCRIPT_RESULT, view->id, done->request, value != NULL,
                    value ? value : error);
        free(value);
        free(error);
        break;
    }
    case CDP_AGENT:
        agent_step(view, done, ok, json);
        break;
    case CDP_ACTION:
        push_answer(SILK_CEF_ACTION_RESULT, view->id, done->request, ok,
                    ok ? "" : "the input did not reach the page");
        break;
    case CDP_SCREENSHOT: {
        size_t textLength = 0;
        char *data = ok ? json_string(json_member(json, "data"), &textLength) : NULL;
        size_t length = 0;
        uint8_t *png = data ? decode_base64(data, textLength, &length) : NULL;
        SilkCefEvent event = blank(SILK_CEF_SCREENSHOT, view->id);
        event.request = done->request;
        push_texts(event, (const char *)png, png ? length : 0, NULL, 0, 1);
        free(png);
        free(data);
        break;
    }
    case CDP_FETCH_ON:
        if (ok) {
            view->fetching = true;
            load_url(view, done->text, done->textLength);
        } else {
            push_text(SILK_CEF_CONSOLE, view->id, "LoadHtml: the Fetch domain is not available");
        }
        break;
    default:
        break;
    }
    free_pending(done);
}

// ---------------------------------------------------------------------------------------
// Commands, run at once on a ready view or queued until it is.

static void run_op(View *view, Op *op) {
    cef_browser_t *browser = view->browser;
    switch (op->kind) {
    case OP_NAVIGATE:
        load_url(view, op->first, op->firstLength);
        break;
    case OP_LOAD_HTML:
        run_load_html(view, op->first, op->firstLength, op->second, op->secondLength);
        break;
    case OP_GO:
        if (op->a == SILK_CEF_BACK) browser->go_back(browser);
        else if (op->a == SILK_CEF_FORWARD) browser->go_forward(browser);
        else if (op->a == SILK_CEF_RELOAD) browser->reload(browser);
        else browser->stop_load(browser);
        break;
    case OP_ZOOM:
        // Chromium's zoom levels are powers of 1.2.
        view->host->set_zoom_level(view->host, op->x > 0 ? log(op->x) / log(1.2) : 0);
        break;
    case OP_FOCUS:
        view->host->set_focus(view->host, op->a ? 1 : 0);
        set_focused(view, op->a != 0);
        break;
    case OP_EVALUATE:
        run_evaluate(view, op->request, op->first, op->firstLength);
        break;
    case OP_AGENT:
        run_agent(view, op->request, op->a, op->first, op->second, op->secondLength);
        break;
    case OP_SCREENSHOT:
        run_screenshot(view, op->request);
        break;
    case OP_CLICK:
        take_keyboard(view);
        click(view, op->x, op->y, op->a, op->b, op->c, NULL);
        break;
    case OP_MOVE:
        mouse(view, "mouseMoved", op->x, op->y, 0, 0, op->c, 0, 0, NULL);
        break;
    case OP_SCROLL:
        mouse(view, "mouseWheel", op->x, op->y, 0, 0, op->c, op->dx, op->dy, NULL);
        break;
    case OP_TYPE:
        type_text(view, op->first, op->firstLength, NULL);
        break;
    case OP_KEY:
        press_key(view, op->first, op->firstLength, op->c, NULL);
        break;
    case OP_DEVTOOLS: {
        cef_window_info_t window;
        memset(&window, 0, sizeof window);
        window.size = sizeof window;
        window.runtime_style = CEF_RUNTIME_STYLE_ALLOY;
        cef_browser_settings_t settings;
        memset(&settings, 0, sizeof settings);
        settings.size = sizeof settings;
        view->host->show_dev_tools(view->host, &window, NULL, &settings, NULL);
        break;
    }
    }
}

static void submit(View *view, Op op) {
    if (view->state == READY) {
        run_op(view, &op);
        free_op(&op);
        return;
    }
    if (view->state == CLOSING) {
        free_op(&op);
        return;
    }
    if (view->opCount == view->opCapacity) {
        size_t capacity = view->opCapacity ? view->opCapacity * 2 : 8;
        Op *grown = realloc(view->ops, capacity * sizeof *grown);
        if (!grown) abort();
        view->ops = grown;
        view->opCapacity = capacity;
    }
    view->ops[view->opCount++] = op;
}

// The agent script is in: the view is Created, loads its first page, and runs what waited.
static void ready(View *view) {
    if (view->state != STARTING) return;
    view->state = READY;
    push(blank(SILK_CEF_CREATED, view->id));
    if (view->url && view->url[0]) load_url(view, view->url, strlen(view->url));
    for (size_t i = 0; i < view->opCount; i++) {
        run_op(view, &view->ops[i]);
        free_op(&view->ops[i]);
    }
    view->opCount = 0;
}

static Op op_of(OpKind kind) {
    Op op;
    memset(&op, 0, sizeof op);
    op.kind = kind;
    return op;
}

// ---------------------------------------------------------------------------------------
// CEF handlers. One of each serves every view; callbacks find the view by its browser.

static cef_app_t app;
static cef_browser_process_handler_t processHandler;
static cef_render_handler_t renderHandler;
static cef_display_handler_t displayHandler;
static cef_load_handler_t loadHandler;
static cef_life_span_handler_t lifeSpanHandler;
static cef_request_handler_t requestHandler;
static cef_focus_handler_t focusHandler;
static cef_dev_tools_message_observer_t devToolsObserver;

// Switches for the browser process, one per line ("name" or "name=value").
static char *extraSwitches;

static void append_switch(cef_command_line_t *line, const char *text, size_t length) {
    const char *equals = memchr(text, '=', length);
    size_t nameLength = equals ? (size_t)(equals - text) : length;
    cef_string_t name = make_string(text, nameLength);
    if (equals) {
        cef_string_t value = make_string(equals + 1, length - nameLength - 1);
        line->append_switch_with_value(line, &name, &value);
        clear_string(&value);
    } else {
        line->append_switch(line, &name);
    }
    clear_string(&name);
}

static void CEF_CALLBACK app_command_line(cef_app_t *self, const cef_string_t *processType,
                                         cef_command_line_t *line) {
    // Only the browser process (no process type) takes the app's switches.
    if (processType && processType->length) {
        release(line);
        return;
    }
    if (startFlags & SILK_CEF_DISABLE_GPU) {
        append_switch(line, "disable-gpu", 11);
        append_switch(line, "disable-gpu-compositing", 23);
    }
    // No keyring prompts for a browser inside an app.
    append_switch(line, "password-store=basic", 20);
    if (extraSwitches) {
        const char *p = extraSwitches;
        while (*p) {
            const char *end = strchr(p, '\n');
            size_t length = end ? (size_t)(end - p) : strlen(p);
            if (length) append_switch(line, p, length);
            p += length + (end ? 1 : 0);
        }
    }
    release(line);
}

static cef_browser_process_handler_t *CEF_CALLBACK app_process_handler(cef_app_t *self) {
    return &processHandler;
}

static void CEF_CALLBACK process_context_initialized(cef_browser_process_handler_t *self) {
    contextReady = true;
}

// --- The message pump: a timer thread wakes the app's loop when CEF wants work. -----------

static pthread_mutex_t pumpLock = PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t pumpChanged = PTHREAD_COND_INITIALIZER;
static pthread_t pumpThread;
static bool pumpRunning;
static double pumpDeadline = INFINITY; // when CEF wants work, in now_seconds()
static double pumpWoken = -1;          // the deadline the timer thread last woke the loop for

// The longest CEF goes without work while it runs, as cefclient's external pump does.
static const double maxPumpDelay = 1.0 / 30.0;

static void schedule(double delaySeconds) {
    pthread_mutex_lock(&pumpLock);
    double at = now_seconds() + (delaySeconds > 0 ? delaySeconds : 0);
    if (at < pumpDeadline) {
        pumpDeadline = at;
        pthread_cond_signal(&pumpChanged);
    }
    pthread_mutex_unlock(&pumpLock);
}

static void CEF_CALLBACK process_schedule_work(cef_browser_process_handler_t *self,
                                               int64_t delayMs) {
    schedule((double)delayMs / 1000.0);
}

static void *pump_timer(void *unused) {
    pthread_mutex_lock(&pumpLock);
    while (pumpRunning) {
        double now = now_seconds();
        if (pumpDeadline <= now) {
            if (pumpWoken != pumpDeadline) {
                pumpWoken = pumpDeadline;
                pthread_mutex_unlock(&pumpLock);
                wake_window();
                pthread_mutex_lock(&pumpLock);
                continue;
            }
            pthread_cond_wait(&pumpChanged, &pumpLock);
        } else if (isinf(pumpDeadline)) {
            pthread_cond_wait(&pumpChanged, &pumpLock);
        } else {
            double wait = pumpDeadline - now;
            struct timespec until;
            clock_gettime(CLOCK_REALTIME, &until);
            long nanoseconds = until.tv_nsec + (long)(fmod(wait, 1.0) * 1e9);
            until.tv_sec += (time_t)wait + nanoseconds / 1000000000L;
            until.tv_nsec = nanoseconds % 1000000000L;
            pthread_cond_timedwait(&pumpChanged, &pumpLock, &until);
        }
    }
    pthread_mutex_unlock(&pumpLock);
    return NULL;
}

static void do_work(void) {
    cef.cef_do_message_loop_work();
    schedule(maxPumpDelay);
}

uint8_t silk_cef_pump(void) {
    if (!started) return 0;
    pthread_mutex_lock(&pumpLock);
    bool due = pumpDeadline <= now_seconds();
    if (due) pumpDeadline = INFINITY;
    pthread_mutex_unlock(&pumpLock);
    if (due) do_work();
    return 1;
}

double silk_cef_next_pump(void) {
    if (!started) return INFINITY;
    pthread_mutex_lock(&pumpLock);
    double wait = pumpDeadline - now_seconds();
    pthread_mutex_unlock(&pumpLock);
    return wait > 0 ? wait : 0;
}

// --- Rendering. ----------------------------------------------------------------------------

static void CEF_CALLBACK render_view_rect(cef_render_handler_t *self, cef_browser_t *browser,
                                          cef_rect_t *rect) {
    View *view = view_of(browser);
    rect->x = rect->y = 0;
    rect->width = 1;
    rect->height = 1;
    if (!view || !view->placed) return;
    int width = (int)lround(view->x1 - view->x0);
    int height = (int)lround(view->y1 - view->y0);
    rect->width = width > 0 ? width : 1;
    rect->height = height > 0 ? height : 1;
}

static int CEF_CALLBACK render_screen_info(cef_render_handler_t *self, cef_browser_t *browser,
                                           cef_screen_info_t *info) {
    View *view = view_of(browser);
    double scale = view && view->scale > 0 ? view->scale : 1.0;
    info->device_scale_factor = (float)scale;
    info->depth = 24;
    info->depth_per_component = 8;
    info->is_monochrome = 0;
    int width = view && view->placed ? (int)lround(view->x1 - view->x0) : 1;
    int height = view && view->placed ? (int)lround(view->y1 - view->y0) : 1;
    info->rect.x = info->rect.y = 0;
    info->rect.width = width > 0 ? width : 1;
    info->rect.height = height > 0 ? height : 1;
    info->available_rect = info->rect;
    return 1;
}

static int CEF_CALLBACK render_screen_point(cef_render_handler_t *self, cef_browser_t *browser,
                                            int viewX, int viewY, int *screenX, int *screenY) {
    View *view = view_of(browser);
    if (!view) return 0;
    *screenX = (int)lround(view->x0) + viewX;
    *screenY = (int)lround(view->y0) + viewY;
    return 1;
}

static void CEF_CALLBACK render_popup_show(cef_render_handler_t *self, cef_browser_t *browser,
                                           int show) {
    View *view = view_of(browser);
    if (!view) return;
    view->popupShown = show != 0;
    if (!show) {
        view->popup.kind = SILK_CEF_FRAME_NONE;
        close_frame(&view->popup);
    }
    view->popup.generation++;
    view->frame.generation++;
    wake_window();
}

static void CEF_CALLBACK render_popup_size(cef_render_handler_t *self, cef_browser_t *browser,
                                           const cef_rect_t *rect) {
    View *view = view_of(browser);
    if (!view) return;
    view->popupX = rect->x;
    view->popupY = rect->y;
    view->popupWidth = rect->width;
    view->popupHeight = rect->height;
}

static void CEF_CALLBACK render_paint(cef_render_handler_t *self, cef_browser_t *browser,
                                      cef_paint_element_type_t type, size_t dirtyCount,
                                      cef_rect_t const *dirty, const void *buffer, int width,
                                      int height) {
    View *view = view_of(browser);
    if (!view || width <= 0 || height <= 0) return;
    Frame *frame = type == PET_POPUP ? &view->popup : &view->frame;
    size_t length = (size_t)width * (size_t)height * 4;
    if (length > frame->capacity) {
        uint8_t *grown = realloc(frame->pixels, length);
        if (!grown) abort();
        frame->pixels = grown;
        frame->capacity = length;
    }
    // The buffer is valid only during this call. With dirty rectangles and an unchanged size,
    // copy only those rows.
    if (frame->kind == SILK_CEF_FRAME_PIXELS && frame->width == (uint32_t)width &&
        frame->height == (uint32_t)height && dirtyCount > 0) {
        for (size_t r = 0; r < dirtyCount; r++) {
            cef_rect_t d = dirty[r];
            int x0 = d.x < 0 ? 0 : d.x, y0 = d.y < 0 ? 0 : d.y;
            int x1 = d.x + d.width > width ? width : d.x + d.width;
            int y1 = d.y + d.height > height ? height : d.y + d.height;
            for (int y = y0; y < y1; y++) {
                size_t offset = ((size_t)y * (size_t)width + (size_t)x0) * 4;
                memcpy(frame->pixels + offset, (const uint8_t *)buffer + offset,
                       (size_t)(x1 - x0) * 4);
            }
        }
    } else {
        memcpy(frame->pixels, buffer, length);
    }
    close_frame(frame);
    frame->kind = SILK_CEF_FRAME_PIXELS;
    frame->width = (uint32_t)width;
    frame->height = (uint32_t)height;
    frame->generation++;
    if (type == PET_POPUP) view->frame.generation++;
    wake_window();
}

// DRM fourcc codes of the formats Chromium paints.
#define FOURCC(a, b, c, d) \
    ((uint32_t)(a) | ((uint32_t)(b) << 8) | ((uint32_t)(c) << 16) | ((uint32_t)(d) << 24))

static void CEF_CALLBACK render_accelerated_paint(cef_render_handler_t *self,
                                                  cef_browser_t *browser,
                                                  cef_paint_element_type_t type, size_t dirtyCount,
                                                  cef_rect_t const *dirty,
                                                  const cef_accelerated_paint_info_t *info) {
    View *view = view_of(browser);
    if (!view || !info || info->plane_count <= 0) return;
    Frame *frame = type == PET_POPUP ? &view->popup : &view->frame;
    // The planes are valid only during this call: keep duplicates of their file descriptors,
    // which the Silk side imports before the next frame.
    close_frame(frame);
    int count = info->plane_count > 4 ? 4 : info->plane_count;
    for (int i = 0; i < count; i++) {
        frame->planes[i].fd = dup(info->planes[i].fd);
        frame->planes[i].stride = info->planes[i].stride;
        frame->planes[i].offset = info->planes[i].offset;
    }
    frame->planeCount = (uint32_t)count;
    frame->kind = SILK_CEF_FRAME_DMABUF;
    frame->width = (uint32_t)info->extra.coded_size.width;
    frame->height = (uint32_t)info->extra.coded_size.height;
    frame->drmModifier = info->modifier;
    frame->drmFormat = info->format == CEF_COLOR_TYPE_RGBA_8888 ? FOURCC('A', 'B', '2', '4')
                                                                 : FOURCC('A', 'R', '2', '4');
    frame->generation++;
    if (type == PET_POPUP) view->frame.generation++;
    wake_window();
}

static void CEF_CALLBACK render_ime_range(cef_render_handler_t *self, cef_browser_t *browser,
                                          const cef_range_t *selected, size_t count,
                                          cef_rect_t const *bounds) {
    View *view = view_of(browser);
    if (!view || count == 0) return;
    // The caret: the end of the composition.
    cef_rect_t last = bounds[count - 1];
    view->hasCaret = true;
    view->caretX = last.x + last.width;
    view->caretY = last.y;
    view->caretWidth = 1;
    view->caretHeight = last.height;
}

// --- Display: titles, URLs, console, cursor, progress. -------------------------------------

static void CEF_CALLBACK display_address(cef_display_handler_t *self, cef_browser_t *browser,
                                         cef_frame_t *frame, const cef_string_t *url) {
    bool main = frame && frame->is_main(frame);
    release(frame);
    View *view = view_of(browser);
    if (!view || !main) return;
    char *text = utf8_of(url, NULL);
    push_text(SILK_CEF_URL_CHANGED, view->id, text);
    free(text);
}

static void CEF_CALLBACK display_title(cef_display_handler_t *self, cef_browser_t *browser,
                                       const cef_string_t *title) {
    View *view = view_of(browser);
    if (!view) return;
    char *text = utf8_of(title, NULL);
    push_text(SILK_CEF_TITLE_CHANGED, view->id, text);
    free(text);
}

static int CEF_CALLBACK display_console(cef_display_handler_t *self, cef_browser_t *browser,
                                       cef_log_severity_t level, const cef_string_t *message,
                                       const cef_string_t *source, int line) {
    View *view = view_of(browser);
    if (!view) return 0;
    char *text = utf8_of(message, NULL);
    SilkCefEvent event = blank(SILK_CEF_CONSOLE, view->id);
    // ConsoleLevel: Debug, Log, Info, Warning, Error. Chromium logs console.log and console.info
    // alike as INFO.
    event.level = level >= LOGSEVERITY_ERROR     ? 4
                  : level == LOGSEVERITY_WARNING ? 3
                  : level == LOGSEVERITY_INFO    ? 1
                                                 : 0;
    push_texts(event, text, strlen(text), NULL, 0, 1);
    free(text);
    return 1;
}

static void CEF_CALLBACK display_progress(cef_display_handler_t *self, cef_browser_t *browser,
                                          double progress) {
    View *view = view_of(browser);
    if (!view) return;
    push_progress(view->id, progress);
}

// platform-window's Cursor discriminants.
enum {
    CURSOR_ARROW,
    CURSOR_IBEAM,
    CURSOR_POINTING_HAND,
    CURSOR_CROSSHAIR,
    CURSOR_CLOSED_HAND,
    CURSOR_OPEN_HAND,
    CURSOR_NOT_ALLOWED,
    CURSOR_RESIZE_LEFT_RIGHT,
    CURSOR_RESIZE_UP_DOWN,
    CURSOR_RESIZE_LEFT,
    CURSOR_RESIZE_RIGHT,
    CURSOR_RESIZE_UP,
    CURSOR_RESIZE_DOWN,
    CURSOR_RESIZE_NWSE,
    CURSOR_RESIZE_NESW,
    CURSOR_RESIZE_COLUMN,
    CURSOR_RESIZE_ROW,
    CURSOR_IBEAM_VERTICAL,
    CURSOR_DRAG_COPY,
    CURSOR_DRAG_LINK,
    CURSOR_CONTEXTUAL_MENU,
    CURSOR_NONE,
};

static uint32_t cursor_of(cef_cursor_type_t type) {
    switch (type) {
    case CT_CROSS: return CURSOR_CROSSHAIR;
    case CT_HAND: return CURSOR_POINTING_HAND;
    case CT_IBEAM: return CURSOR_IBEAM;
    case CT_VERTICALTEXT: return CURSOR_IBEAM_VERTICAL;
    case CT_EASTRESIZE: return CURSOR_RESIZE_RIGHT;
    case CT_WESTRESIZE: return CURSOR_RESIZE_LEFT;
    case CT_NORTHRESIZE: return CURSOR_RESIZE_UP;
    case CT_SOUTHRESIZE: return CURSOR_RESIZE_DOWN;
    case CT_EASTWESTRESIZE: return CURSOR_RESIZE_LEFT_RIGHT;
    case CT_NORTHSOUTHRESIZE: return CURSOR_RESIZE_UP_DOWN;
    case CT_NORTHEASTRESIZE:
    case CT_SOUTHWESTRESIZE:
    case CT_NORTHEASTSOUTHWESTRESIZE: return CURSOR_RESIZE_NESW;
    case CT_NORTHWESTRESIZE:
    case CT_SOUTHEASTRESIZE:
    case CT_NORTHWESTSOUTHEASTRESIZE: return CURSOR_RESIZE_NWSE;
    case CT_COLUMNRESIZE: return CURSOR_RESIZE_COLUMN;
    case CT_ROWRESIZE: return CURSOR_RESIZE_ROW;
    case CT_GRAB: return CURSOR_OPEN_HAND;
    case CT_GRABBING:
    case CT_MOVE: return CURSOR_CLOSED_HAND;
    case CT_NODROP:
    case CT_NOTALLOWED: return CURSOR_NOT_ALLOWED;
    case CT_COPY: return CURSOR_DRAG_COPY;
    case CT_ALIAS: return CURSOR_DRAG_LINK;
    case CT_CONTEXTMENU: return CURSOR_CONTEXTUAL_MENU;
    case CT_NONE: return CURSOR_NONE;
    default: return CURSOR_ARROW;
    }
}

static int CEF_CALLBACK display_cursor(cef_display_handler_t *self, cef_browser_t *browser,
                                       cef_cursor_handle_t handle, cef_cursor_type_t type,
                                       const cef_cursor_info_t *custom) {
    View *view = view_of(browser);
    if (!view) return 1;
    uint32_t cursor = cursor_of(type);
    if (cursor != view->cursor) {
        view->cursor = cursor;
        wake_window();
    }
    return 1;
}

// --- Loading and navigation. ---------------------------------------------------------------

static void CEF_CALLBACK load_state(cef_load_handler_t *self, cef_browser_t *browser,
                                    int isLoading, int canGoBack, int canGoForward) {
    View *view = view_of(browser);
    if (!view) return;
    if (view->canGoBack != (canGoBack != 0) || view->canGoForward != (canGoForward != 0)) {
        view->canGoBack = canGoBack != 0;
        view->canGoForward = canGoForward != 0;
        SilkCefEvent event = blank(SILK_CEF_HISTORY_CHANGED, view->id);
        if (canGoBack) event.flags |= SILK_CEF_FLAG_OK;
        if (canGoForward) event.flags |= SILK_CEF_FLAG_SECOND;
        push(event);
    }
}

static char *frame_url(cef_frame_t *frame) {
    return frame ? take_string(frame->get_url(frame)) : copy_bytes("", 0);
}

static void CEF_CALLBACK load_start(cef_load_handler_t *self, cef_browser_t *browser,
                                    cef_frame_t *frame, cef_transition_type_t transition) {
    bool main = frame && frame->is_main(frame);
    char *url = main ? frame_url(frame) : NULL;
    release(frame);
    View *view = view_of(browser);
    if (view && main) push_text(SILK_CEF_LOAD_STARTED, view->id, url);
    free(url);
}

static void CEF_CALLBACK load_end(cef_load_handler_t *self, cef_browser_t *browser,
                                  cef_frame_t *frame, int status) {
    bool main = frame && frame->is_main(frame);
    char *url = main ? frame_url(frame) : NULL;
    release(frame);
    View *view = view_of(browser);
    if (view && main) {
        SilkCefEvent event = blank(SILK_CEF_LOAD_FINISHED, view->id);
        event.flags |= SILK_CEF_FLAG_OK;
        push_texts(event, url, strlen(url), "", 0, 2);
    }
    free(url);
}

static void CEF_CALLBACK load_error(cef_load_handler_t *self, cef_browser_t *browser,
                                    cef_frame_t *frame, cef_errorcode_t code,
                                    const cef_string_t *text, const cef_string_t *failedUrl) {
    bool main = frame && frame->is_main(frame);
    release(frame);
    View *view = view_of(browser);
    // ERR_ABORTED: a navigation canceled here (asked about) or replaced by another.
    if (!view || !main || code == ERR_ABORTED) return;
    size_t urlLength = 0, errorLength = 0;
    char *url = utf8_of(failedUrl, &urlLength);
    char *error = utf8_of(text, &errorLength);
    push_texts(blank(SILK_CEF_LOAD_FINISHED, view->id), url, urlLength, error, errorLength, 2);
    free(url);
    free(error);
}

static int CEF_CALLBACK request_before_browse(cef_request_handler_t *self, cef_browser_t *browser,
                                              cef_frame_t *frame, cef_request_t *request,
                                              int userGesture, int isRedirect) {
    bool main = frame && frame->is_main(frame);
    release(frame);
    cef_transition_type_t transition = request->get_transition_type(request);
    char *url = take_string(request->get_url(request));
    release(request);
    View *view = view_of(browser);
    if (!view || !main || isRedirect) {
        free(url);
        return 0;
    }
    bool ask = (view->flags & SILK_CEF_ASK_BEFORE_NAVIGATING) != 0 && view->state == READY;
    // Back, forward and reload are never asked about.
    if ((transition & TT_FORWARD_BACK_FLAG) || (transition & TT_SOURCE_MASK) == TT_RELOAD)
        ask = false;
    if (view->skipNextAsk) {
        // LoadHtml is the client's own page, and an allowed navigation was asked about already.
        view->skipNextAsk = false;
        ask = false;
    }
    if (!ask) {
        free(url);
        return 0;
    }
    if (view->decisionCount == view->decisionCapacity) {
        size_t capacity = view->decisionCapacity ? view->decisionCapacity * 2 : 4;
        Decision *grown = realloc(view->decisions, capacity * sizeof *grown);
        if (!grown) abort();
        view->decisions = grown;
        view->decisionCapacity = capacity;
    }
    Decision *decision = &view->decisions[view->decisionCount++];
    decision->request = view->nextRequest++;
    decision->url = url;
    push_answer(SILK_CEF_NAVIGATION_REQUESTED, view->id, decision->request, userGesture != 0, url);
    return 1;
}

static void CEF_CALLBACK request_terminated(cef_request_handler_t *self, cef_browser_t *browser,
                                           cef_termination_status_t status, int code,
                                           const cef_string_t *text) {
    View *view = view_of(browser);
    if (!view) return;
    char *reason = utf8_of(text, NULL);
    if (!reason[0]) {
        free(reason);
        const char *name = status == TS_PROCESS_CRASHED ? "the page's process crashed"
                           : status == TS_PROCESS_OOM   ? "the page's process ran out of memory"
                                                        : "the page's process was killed";
        reason = copy_bytes(name, strlen(name));
    }
    push_text(SILK_CEF_CRASHED, view->id, reason);
    free(reason);
}

// --- Life span: creation, popups, closing. -------------------------------------------------

static int CEF_CALLBACK life_before_popup(
    cef_life_span_handler_t *self, cef_browser_t *browser, cef_frame_t *frame, int popupId,
    const cef_string_t *targetUrl, const cef_string_t *targetName,
    cef_window_open_disposition_t disposition, int userGesture, const cef_popup_features_t *features,
    cef_window_info_t *windowInfo, cef_client_t **client, cef_browser_settings_t *settings,
    cef_dictionary_value_t **extra, int *noJavascriptAccess) {
    release(frame);
    View *view = view_of(browser);
    if (view) {
        char *url = utf8_of(targetUrl, NULL);
        push_text(SILK_CEF_NEW_WINDOW_REQUESTED, view->id, url);
        free(url);
    }
    // The view never opens a window itself; the app decides.
    return 1;
}

static void CEF_CALLBACK life_after_created(cef_life_span_handler_t *self, cef_browser_t *browser) {
    cef_browser_host_t *host = browser->get_host(browser);
    cef_client_t *client = host ? host->get_client(host) : NULL;
    // Only browsers made with a view's client reach this handler.
    View *view = client ? find_serial(((ViewClient *)client)->serial) : NULL;
    release(client);
    if (!view || view->browser) {
        if (host) host->close_browser(host, 1);
        release(host);
        release(browser);
        return;
    }
    // Keep the references: the view owns them until on_before_close.
    view->browser = browser;
    view->host = host;
    view->browserId = browser->get_identifier(browser);
    view->observer = host->add_dev_tools_message_observer(host, &devToolsObserver);
    host->was_hidden(host, view->placed && view->shows ? 0 : 1);
    if (view->state == CLOSING) {
        host->close_browser(host, 1);
        return;
    }
    // The agent script goes in at document start of every page from now on; then the view is
    // ready and loads its first page.
    Buffer params = {0};
    buffer_text(&params, "{\"source\":");
    buffer_json(&params, agentScript ? agentScript : "", agentScript ? agentScriptLength : 0);
    buffer_text(&params, ",\"worldName\":");
    buffer_json(&params, agentWorld, strlen(agentWorld));
    buffer_text(&params, ",\"runImmediately\":true}");
    cdp(view, "Page.addScriptToEvaluateOnNewDocument", params.data, cdp_answer(CDP_SETUP, view));
    buffer_free(&params);
}

static int CEF_CALLBACK life_do_close(cef_life_span_handler_t *self, cef_browser_t *browser) {
    release(browser);
    // Let CEF close the browser (there is no native window to close first).
    return 0;
}

static void CEF_CALLBACK life_before_close(cef_life_span_handler_t *self, cef_browser_t *browser) {
    View *view = view_of(browser);
    if (!view) return;
    push(blank(SILK_CEF_CLOSED, view->id));
    release(view->observer);
    release(view->host);
    release(view->browser);
    view->observer = NULL;
    view->host = NULL;
    view->browser = NULL;
    remove_view(view);
}

// --- Focus. --------------------------------------------------------------------------------

static void CEF_CALLBACK focus_take(cef_focus_handler_t *self, cef_browser_t *browser, int next) {
    View *view = view_of(browser);
    // Tab past the page's last (or before its first) focusable element: focus leaves the page.
    if (view) {
        if (view->host) view->host->set_focus(view->host, 0);
        set_focused(view, false);
    }
}

static int CEF_CALLBACK focus_set(cef_focus_handler_t *self, cef_browser_t *browser,
                                  cef_focus_source_t source) {
    release(browser);
    return 0;
}

static void CEF_CALLBACK focus_got(cef_focus_handler_t *self, cef_browser_t *browser) {
    View *view = view_of(browser);
    if (view) set_focused(view, true);
}

// --- DevTools protocol answers and events. -------------------------------------------------

static int CEF_CALLBACK devtools_message(cef_dev_tools_message_observer_t *self,
                                         cef_browser_t *browser, const void *message, size_t size) {
    release(browser);
    // Not handled here: CEF splits it into method results and events.
    return 0;
}

static void CEF_CALLBACK devtools_result(cef_dev_tools_message_observer_t *self,
                                         cef_browser_t *browser, int id, int success,
                                         const void *result, size_t size) {
    release(browser);
    for (size_t i = 0; i < pendingCount; i++) {
        if (pendings[i].id != id) continue;
        Pending *done = malloc(sizeof *done);
        if (!done) abort();
        *done = pendings[i];
        memmove(&pendings[i], &pendings[i + 1], (pendingCount - i - 1) * sizeof *pendings);
        pendingCount--;
        char *json = copy_bytes(result ? result : "", result ? size : 0);
        cdp_answered(done, success != 0, json);
        free(json);
        return;
    }
}

static void CEF_CALLBACK devtools_event(cef_dev_tools_message_observer_t *self,
                                        cef_browser_t *browser, const cef_string_t *method,
                                        const void *params, size_t size) {
    View *view = view_of(browser);
    if (!view) return;
    char *name = utf8_of(method, NULL);
    if (strcmp(name, "Fetch.requestPaused") == 0) {
        char *json = copy_bytes(params ? params : "", params ? size : 0);
        fetch_paused(view, json);
        free(json);
    }
    free(name);
}

static void CEF_CALLBACK devtools_attached(cef_dev_tools_message_observer_t *self,
                                           cef_browser_t *browser) {
    release(browser);
}

static void CEF_CALLBACK devtools_detached(cef_dev_tools_message_observer_t *self,
                                           cef_browser_t *browser) {
    release(browser);
}

// --- The client. ---------------------------------------------------------------------------

static cef_render_handler_t *CEF_CALLBACK client_render(cef_client_t *self) { return &renderHandler; }
static cef_display_handler_t *CEF_CALLBACK client_display(cef_client_t *self) { return &displayHandler; }
static cef_load_handler_t *CEF_CALLBACK client_load(cef_client_t *self) { return &loadHandler; }
static cef_life_span_handler_t *CEF_CALLBACK client_life_span(cef_client_t *self) {
    return &lifeSpanHandler;
}
static cef_request_handler_t *CEF_CALLBACK client_request(cef_client_t *self) { return &requestHandler; }
static cef_focus_handler_t *CEF_CALLBACK client_focus(cef_client_t *self) { return &focusHandler; }

static ViewClient *make_client(uint64_t serial) {
    ViewClient *made = calloc(1, sizeof *made);
    if (!made) abort();
    init_base(&made->client.base, sizeof made->client);
    made->client.get_render_handler = client_render;
    made->client.get_display_handler = client_display;
    made->client.get_load_handler = client_load;
    made->client.get_life_span_handler = client_life_span;
    made->client.get_request_handler = client_request;
    made->client.get_focus_handler = client_focus;
    made->serial = serial;
    return made;
}

static void init_handlers(void) {
    init_base(&app.base, sizeof app);
    app.on_before_command_line_processing = app_command_line;
    app.get_browser_process_handler = app_process_handler;

    init_base(&processHandler.base, sizeof processHandler);
    processHandler.on_context_initialized = process_context_initialized;
    processHandler.on_schedule_message_pump_work = process_schedule_work;

    init_base(&renderHandler.base, sizeof renderHandler);
    renderHandler.get_view_rect = render_view_rect;
    renderHandler.get_screen_info = render_screen_info;
    renderHandler.get_screen_point = render_screen_point;
    renderHandler.on_popup_show = render_popup_show;
    renderHandler.on_popup_size = render_popup_size;
    renderHandler.on_paint = render_paint;
    renderHandler.on_accelerated_paint = render_accelerated_paint;
    renderHandler.on_ime_composition_range_changed = render_ime_range;

    init_base(&displayHandler.base, sizeof displayHandler);
    displayHandler.on_address_change = display_address;
    displayHandler.on_title_change = display_title;
    displayHandler.on_console_message = display_console;
    displayHandler.on_loading_progress_change = display_progress;
    displayHandler.on_cursor_change = display_cursor;

    init_base(&loadHandler.base, sizeof loadHandler);
    loadHandler.on_loading_state_change = load_state;
    loadHandler.on_load_start = load_start;
    loadHandler.on_load_end = load_end;
    loadHandler.on_load_error = load_error;

    init_base(&lifeSpanHandler.base, sizeof lifeSpanHandler);
    lifeSpanHandler.on_before_popup = life_before_popup;
    lifeSpanHandler.on_after_created = life_after_created;
    lifeSpanHandler.do_close = life_do_close;
    lifeSpanHandler.on_before_close = life_before_close;

    init_base(&requestHandler.base, sizeof requestHandler);
    requestHandler.on_before_browse = request_before_browse;
    requestHandler.on_render_process_terminated = request_terminated;

    init_base(&focusHandler.base, sizeof focusHandler);
    focusHandler.on_take_focus = focus_take;
    focusHandler.on_set_focus = focus_set;
    focusHandler.on_got_focus = focus_got;

    init_base(&devToolsObserver.base, sizeof devToolsObserver);
    devToolsObserver.on_dev_tools_message = devtools_message;
    devToolsObserver.on_dev_tools_method_result = devtools_result;
    devToolsObserver.on_dev_tools_event = devtools_event;
    devToolsObserver.on_dev_tools_agent_attached = devtools_attached;
    devToolsObserver.on_dev_tools_agent_detached = devtools_detached;
}

// ---------------------------------------------------------------------------------------
// Starting and stopping CEF.

static char *path_join(const char *dir, size_t dirLength, const char *name) {
    Buffer out = {0};
    buffer_add(&out, dir, dirLength);
    if (dirLength && dir[dirLength - 1] != '/') buffer_add(&out, "/", 1);
    buffer_text(&out, name);
    return out.data;
}

static void set_path(cef_string_t *field, const char *text) {
    *field = make_string(text, strlen(text));
}

// Forgets a libcef.so that turned out not to fit, so a later start can try another.
static void unload_library(void) {
    dlclose(library);
    library = NULL;
    memset(&cef, 0, sizeof cef);
}

uint32_t silk_cef_start(const uint8_t *runtimeDir, size_t runtimeDirLength,
                        const uint8_t *helperPath, size_t helperPathLength,
                        const uint8_t *root, size_t rootLength, const uint8_t *switches,
                        size_t switchesLength, uint32_t flags, const uint8_t *script,
                        size_t scriptLength) {
    if (started || library) return SILK_CEF_ALREADY;
    const char *dir = (const char *)runtimeDir;
    char *libraryPath = path_join(dir, runtimeDirLength, "libcef.so");
    library = dlopen(libraryPath, RTLD_NOW | RTLD_LOCAL);
    if (!library) {
        set_error("libcef.so did not load: %s", dlerror());
        free(libraryPath);
        return SILK_CEF_NO_LIBRARY;
    }
    free(libraryPath);
#define RESOLVE(name)                                                     \
    cef.name = (__typeof__(name) *)dlsym(library, #name);                 \
    if (!cef.name) {                                                      \
        set_error("libcef.so has no %s", #name);                          \
        unload_library();                                                 \
        return SILK_CEF_WRONG_VERSION;                                    \
    }
    CEF_FUNCTIONS(RESOLVE)
#undef RESOLVE
    // Configures the API version this bridge was built for, and checks the library has it.
    const char *hash = cef.cef_api_hash(CEF_API_VERSION, 0);
    if (!hash || strcmp(hash, CEF_API_HASH_PLATFORM) != 0) {
        set_error("libcef.so is not the CEF version this bridge was built for (API hash %s)", hash);
        unload_library();
        return SILK_CEF_WRONG_VERSION;
    }

    startFlags = flags;
    agentScript = copy_bytes(script, scriptLength);
    agentScriptLength = scriptLength;
    extraSwitches = copy_bytes(switches, switchesLength);
    if (rootLength) {
        cacheRoot = copy_bytes(root, rootLength);
    } else {
        // CEF wants a root directory even when nothing persists.
        char pattern[] = "/tmp/silk-cef-XXXXXX";
        char *made = mkdtemp(pattern);
        cacheRoot = copy_bytes(made ? made : "/tmp", strlen(made ? made : "/tmp"));
    }
    mkdir(cacheRoot, 0700);
    init_handlers();

    cef_settings_t settings;
    memset(&settings, 0, sizeof settings);
    settings.size = sizeof settings;
    settings.no_sandbox = (flags & SILK_CEF_NO_SANDBOX) ? 1 : 0;
    settings.multi_threaded_message_loop = 0;
    settings.external_message_pump = 1;
    settings.windowless_rendering_enabled = 1;
    settings.command_line_args_disabled = 1;
    settings.persist_session_cookies = 1;
    // Without a helper named, CEF's other processes run silk-cef-helper from the runtime directory.
    char *helper = helperPathLength ? copy_bytes(helperPath, helperPathLength)
                                    : path_join(dir, runtimeDirLength, "silk-cef-helper");
    char *dirText = copy_bytes(dir, runtimeDirLength);
    char *locales = path_join(dir, runtimeDirLength, "locales");
    set_path(&settings.browser_subprocess_path, helper);
    set_path(&settings.resources_dir_path, dirText);
    set_path(&settings.locales_dir_path, locales);
    set_path(&settings.root_cache_path, cacheRoot);
    const char *log = getenv("SILK_CEF_LOG");
    settings.log_severity = log && log[0] ? LOGSEVERITY_VERBOSE : LOGSEVERITY_ERROR;
    if (log && log[0]) set_path(&settings.log_file, log);
    settings.background_color = 0xFFFFFFFF;

    char *argv0 = copy_bytes("silk-app", 8);
    char *argv[] = {argv0, NULL};
    cef_main_args_t args = {1, argv};
    int ok = cef.cef_initialize(&args, &settings, &app, NULL);
    clear_string(&settings.browser_subprocess_path);
    clear_string(&settings.resources_dir_path);
    clear_string(&settings.locales_dir_path);
    clear_string(&settings.root_cache_path);
    clear_string(&settings.log_file);
    free(helper);
    free(dirText);
    free(locales);
    if (!ok) {
        set_error("cef_initialize failed (exit code %s)", "see the log");
        return SILK_CEF_INIT_FAILED;
    }
    started = true;
    pumpRunning = true;
    pthread_create(&pumpThread, NULL, pump_timer, NULL);
    schedule(0);
    return SILK_CEF_STARTED;
}

void silk_cef_shutdown(void) {
    if (!started || shuttingDown) return;
    shuttingDown = true;
    for (size_t i = 0; i < viewCount; i++) {
        View *view = views[i];
        view->state = CLOSING;
        if (view->host) view->host->close_browser(view->host, 1);
    }
    // Pump until every browser closed (or a few seconds pass).
    double until = now_seconds() + 5.0;
    while (now_seconds() < until) {
        bool open = false;
        for (size_t i = 0; i < viewCount; i++)
            if (views[i]->browser) open = true;
        if (!open && contextReady) break;
        cef.cef_do_message_loop_work();
        usleep(5000);
    }
    pthread_mutex_lock(&pumpLock);
    pumpRunning = false;
    pthread_cond_signal(&pumpChanged);
    pthread_mutex_unlock(&pumpLock);
    pthread_join(pumpThread, NULL);
    cef.cef_shutdown();
    started = false;
}

// ---------------------------------------------------------------------------------------
// Views: the C ABI.

static char *profile_path(const char *profile, size_t length) {
    // A directory name made of the profile's safe characters, under the root.
    Buffer name = {0};
    buffer_text(&name, "profile-");
    for (size_t i = 0; i < length; i++) {
        char c = profile[i];
        bool safe = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') ||
                    c == '-' || c == '_' || c == '.';
        if (safe) buffer_add(&name, &c, 1);
        else buffer_format(&name, "%%%02X", (unsigned char)c);
    }
    char *path = path_join(cacheRoot, strlen(cacheRoot), name.data);
    buffer_free(&name);
    return path;
}

uint32_t silk_cef_open(uint32_t id, const uint8_t *url, size_t urlLength, const uint8_t *profile,
                       size_t profileLength, uint32_t flags) {
    if (!started || shuttingDown) return SILK_CEF_NOT_STARTED;
    if (find_view(id)) return SILK_CEF_ID_IN_USE;
    View *view = calloc(1, sizeof *view);
    if (!view) abort();
    view->id = id;
    view->serial = nextSerial++;
    view->state = STARTING;
    view->flags = flags;
    view->scale = 1.0;
    view->nextRequest = 1;
    view->frame.planeCount = 0;
    view->popup.planeCount = 0;
    view->url = copy_bytes(url, urlLength);
    view->client = make_client(view->serial);

    cef_window_info_t window;
    memset(&window, 0, sizeof window);
    window.size = sizeof window;
    window.windowless_rendering_enabled = 1;
    window.shared_texture_enabled = (startFlags & SILK_CEF_SHARED_TEXTURES) ? 1 : 0;
    window.runtime_style = CEF_RUNTIME_STYLE_ALLOY;

    cef_browser_settings_t settings;
    memset(&settings, 0, sizeof settings);
    settings.size = sizeof settings;
    settings.windowless_frame_rate = 60;
    settings.background_color = (flags & SILK_CEF_TRANSPARENT) ? 0x00000000 : 0xFFFFFFFF;

    cef_request_context_settings_t contextSettings;
    memset(&contextSettings, 0, sizeof contextSettings);
    contextSettings.size = sizeof contextSettings;
    char *path = NULL;
    if (profileLength) {
        // A named profile persists under the root; none is an in-memory session of its own.
        path = profile_path((const char *)profile, profileLength);
        set_path(&contextSettings.cache_path, path);
        contextSettings.persist_session_cookies = 1;
    }
    cef_request_context_t *context = cef.cef_request_context_create_context(&contextSettings, NULL);
    clear_string(&contextSettings.cache_path);
    free(path);

    if (viewCount == viewCapacity) {
        size_t capacity = viewCapacity ? viewCapacity * 2 : 4;
        View **grown = realloc(views, capacity * sizeof *grown);
        if (!grown) abort();
        views = grown;
        viewCapacity = capacity;
    }
    views[viewCount++] = view;

    // about:blank first: the first real page loads once the agent script is registered.
    cef_string_t blankUrl = make_string("about:blank", 11);
    int created = cef.cef_browser_host_create_browser(&window, &view->client->client, &blankUrl,
                                                      &settings, NULL, context);
    clear_string(&blankUrl);
    if (!created) {
        viewCount--;
        free_view(view);
        return SILK_CEF_CREATION_FAILED;
    }
    schedule(0);
    return SILK_CEF_OPENED;
}

void silk_cef_close(uint32_t id) {
    View *view = find_view(id);
    if (!view || view->state == CLOSING) return;
    view->state = CLOSING;
    if (view->host) {
        view->host->close_browser(view->host, 1);
        schedule(0);
    }
    // Before the browser exists, life_after_created closes it.
}

uint8_t silk_cef_exists(uint32_t id) {
    View *view = find_view(id);
    return view && view->state != CLOSING ? 1 : 0;
}

void silk_cef_place(uint32_t id, double x0, double y0, double x1, double y1, double clipX0,
                    double clipY0, double clipX1, double clipY1, uint8_t visible, double scale) {
    View *view = find_view(id);
    if (!view) return;
    bool shows = visible && clipX1 > clipX0 && clipY1 > clipY0;
    bool resized = !view->placed || fabs((x1 - x0) - (view->x1 - view->x0)) > 0.01 ||
                   fabs((y1 - y0) - (view->y1 - view->y0)) > 0.01;
    bool rescaled = view->placed && fabs(scale - view->scale) > 0.001;
    bool shown = !view->placed || shows != view->shows;
    view->placed = true;
    view->x0 = x0;
    view->y0 = y0;
    view->x1 = x1;
    view->y1 = y1;
    view->scale = scale > 0 ? scale : 1.0;
    view->shows = shows;
    if (!view->host) return;
    if (rescaled) view->host->notify_screen_info_changed(view->host);
    if (resized || rescaled) view->host->was_resized(view->host);
    if (shown) view->host->was_hidden(view->host, shows ? 0 : 1);
    if (!shows && view->focused) {
        view->host->set_focus(view->host, 0);
        set_focused(view, false);
    }
    schedule(0);
}

void silk_cef_navigate(uint32_t id, const uint8_t *url, size_t length) {
    View *view = find_view(id);
    if (!view) return;
    Op op = op_of(OP_NAVIGATE);
    op.first = copy_bytes(url, length);
    op.firstLength = length;
    submit(view, op);
}

void silk_cef_load_html(uint32_t id, const uint8_t *html, size_t htmlLength,
                        const uint8_t *baseUrl, size_t baseUrlLength) {
    View *view = find_view(id);
    if (!view) return;
    Op op = op_of(OP_LOAD_HTML);
    op.first = copy_bytes(html, htmlLength);
    op.firstLength = htmlLength;
    op.second = copy_bytes(baseUrl, baseUrlLength);
    op.secondLength = baseUrlLength;
    submit(view, op);
}

void silk_cef_go(uint32_t id, uint32_t operation) {
    View *view = find_view(id);
    if (!view) return;
    Op op = op_of(OP_GO);
    op.a = operation;
    submit(view, op);
}

void silk_cef_set_zoom(uint32_t id, double factor) {
    View *view = find_view(id);
    if (!view) return;
    Op op = op_of(OP_ZOOM);
    op.x = factor;
    submit(view, op);
}

void silk_cef_focus(uint32_t id, uint8_t focused) {
    View *view = find_view(id);
    if (!view) return;
    Op op = op_of(OP_FOCUS);
    op.a = focused;
    submit(view, op);
}

void silk_cef_evaluate(uint32_t id, uint32_t request, const uint8_t *script, size_t length) {
    View *view = find_view(id);
    if (!view) return;
    Op op = op_of(OP_EVALUATE);
    op.request = request;
    op.first = copy_bytes(script, length);
    op.firstLength = length;
    submit(view, op);
}

void silk_cef_agent(uint32_t id, uint32_t request, uint32_t operation, const uint8_t *call,
                    size_t callLength, const uint8_t *text, size_t textLength) {
    View *view = find_view(id);
    if (!view) return;
    Op op = op_of(OP_AGENT);
    op.request = request;
    op.a = operation;
    op.first = copy_bytes(call, callLength);
    op.firstLength = callLength;
    op.second = copy_bytes(text, textLength);
    op.secondLength = textLength;
    submit(view, op);
}

void silk_cef_screenshot(uint32_t id, uint32_t request) {
    View *view = find_view(id);
    if (!view) return;
    Op op = op_of(OP_SCREENSHOT);
    op.request = request;
    submit(view, op);
}

void silk_cef_click(uint32_t id, double x, double y, uint32_t button, uint32_t clickCount,
                    uint32_t modifiers) {
    View *view = find_view(id);
    if (!view) return;
    Op op = op_of(OP_CLICK);
    op.x = x;
    op.y = y;
    op.a = button;
    op.b = clickCount;
    op.c = modifiers;
    submit(view, op);
}

void silk_cef_move_pointer(uint32_t id, double x, double y, uint32_t modifiers) {
    View *view = find_view(id);
    if (!view) return;
    Op op = op_of(OP_MOVE);
    op.x = x;
    op.y = y;
    op.c = modifiers;
    submit(view, op);
}

void silk_cef_scroll(uint32_t id, double x, double y, double deltaX, double deltaY,
                     uint32_t modifiers) {
    View *view = find_view(id);
    if (!view) return;
    Op op = op_of(OP_SCROLL);
    op.x = x;
    op.y = y;
    op.dx = deltaX;
    op.dy = deltaY;
    op.c = modifiers;
    submit(view, op);
}

void silk_cef_type_text(uint32_t id, const uint8_t *text, size_t length) {
    View *view = find_view(id);
    if (!view) return;
    Op op = op_of(OP_TYPE);
    op.first = copy_bytes(text, length);
    op.firstLength = length;
    submit(view, op);
}

uint8_t silk_cef_press_key(uint32_t id, const uint8_t *name, size_t length, uint32_t modifiers) {
    View *view = find_view(id);
    if (!view) return 1;
    if (!known_key((const char *)name, length)) return 0;
    Op op = op_of(OP_KEY);
    op.first = copy_bytes(name, length);
    op.firstLength = length;
    op.c = modifiers;
    submit(view, op);
    return 1;
}

void silk_cef_answer_navigation(uint32_t id, uint32_t request, uint8_t allow) {
    View *view = find_view(id);
    if (!view) return;
    for (size_t i = 0; i < view->decisionCount; i++) {
        if (view->decisions[i].request != request) continue;
        char *url = view->decisions[i].url;
        memmove(&view->decisions[i], &view->decisions[i + 1],
                (view->decisionCount - i - 1) * sizeof *view->decisions);
        view->decisionCount--;
        if (allow) {
            // The navigation was canceled to ask about it: start it again, unasked.
            view->skipNextAsk = true;
            load_url(view, url, strlen(url));
        }
        free(url);
        return;
    }
}

uint8_t silk_cef_open_devtools(uint32_t id) {
    View *view = find_view(id);
    if (!view) return 1;
    if (!(view->flags & SILK_CEF_INSPECTABLE)) return 0;
    submit(view, op_of(OP_DEVTOOLS));
    return 1;
}

// ---------------------------------------------------------------------------------------
// A person's input.

static uint32_t event_flags(uint32_t modifiers) {
    uint32_t flags = 0;
    if (modifiers & 1) flags |= EVENTFLAG_SHIFT_DOWN;
    if (modifiers & 2) flags |= EVENTFLAG_CONTROL_DOWN;
    if (modifiers & 4) flags |= EVENTFLAG_ALT_DOWN;
    if (modifiers & 8) flags |= EVENTFLAG_COMMAND_DOWN;
    if (modifiers & SILK_CEF_MOD_CAPS_LOCK) flags |= EVENTFLAG_CAPS_LOCK_ON;
    if (modifiers & SILK_CEF_MOD_LEFT_BUTTON) flags |= EVENTFLAG_LEFT_MOUSE_BUTTON;
    if (modifiers & SILK_CEF_MOD_MIDDLE_BUTTON) flags |= EVENTFLAG_MIDDLE_MOUSE_BUTTON;
    if (modifiers & SILK_CEF_MOD_RIGHT_BUTTON) flags |= EVENTFLAG_RIGHT_MOUSE_BUTTON;
    if (modifiers & SILK_CEF_MOD_KEYPAD) flags |= EVENTFLAG_IS_KEY_PAD;
    return flags;
}

static cef_mouse_event_t mouse_event(double x, double y, uint32_t modifiers) {
    cef_mouse_event_t event;
    event.x = (int)floor(x);
    event.y = (int)floor(y);
    event.modifiers = event_flags(modifiers);
    return event;
}

static View *input_view(uint32_t id) {
    View *view = find_view(id);
    if (!view || view->state != READY || !view->host) return NULL;
    schedule(0);
    return view;
}

void silk_cef_mouse_move(uint32_t id, double x, double y, uint32_t modifiers, uint8_t leave) {
    View *view = input_view(id);
    if (!view) return;
    cef_mouse_event_t event = mouse_event(x, y, modifiers);
    view->host->send_mouse_move_event(view->host, &event, leave ? 1 : 0);
}

void silk_cef_mouse_button(uint32_t id, double x, double y, uint32_t button, uint8_t up,
                           uint32_t clickCount, uint32_t modifiers) {
    View *view = input_view(id);
    if (!view) return;
    if (!up) {
        // A click into the page gives it keyboard focus.
        view->host->set_focus(view->host, 1);
        set_focused(view, true);
    }
    cef_mouse_event_t event = mouse_event(x, y, modifiers);
    cef_mouse_button_type_t type = button == 1 ? MBT_MIDDLE : button == 2 ? MBT_RIGHT : MBT_LEFT;
    view->host->send_mouse_click_event(view->host, &event, type, up ? 1 : 0,
                                       (int)(clickCount ? clickCount : 1));
}

void silk_cef_mouse_wheel(uint32_t id, double x, double y, double deltaX, double deltaY,
                          uint32_t modifiers) {
    View *view = input_view(id);
    if (!view) return;
    cef_mouse_event_t event = mouse_event(x, y, modifiers);
    view->host->send_mouse_wheel_event(view->host, &event, (int)lround(deltaX), (int)lround(deltaY));
}

void silk_cef_key(uint32_t id, uint32_t kind, uint32_t code, uint32_t character,
                  uint32_t modifiers) {
    View *view = input_view(id);
    if (!view) return;
    cef_key_event_t event;
    memset(&event, 0, sizeof event);
    event.size = sizeof event;
    event.modifiers = event_flags(modifiers);
    if (code < SILK_CEF_KEY_COUNT) {
        event.windows_key_code = silk_cef_keys[code][0];
        event.native_key_code = silk_cef_keys[code][1];
    }
    event.is_system_key = (modifiers & 4) ? 1 : 0;
    if (kind == SILK_CEF_KEY_CHAR) {
        event.type = KEYEVENT_CHAR;
        event.character = (char16_t)character;
        event.unmodified_character = (char16_t)character;
        if (code >= SILK_CEF_KEY_COUNT || event.windows_key_code == 0)
            event.windows_key_code = (int)character;
    } else {
        event.type = kind == SILK_CEF_KEY_UP ? KEYEVENT_KEYUP : KEYEVENT_RAWKEYDOWN;
    }
    view->host->send_key_event(view->host, &event);
}

// The UTF-16 offset of UTF-8 byte `offset` in `text`.
static size_t utf16_offset(const uint8_t *text, size_t length, size_t offset) {
    size_t units = 0;
    for (size_t i = 0; i < length && i < offset;) {
        size_t step = utf8_length(text[i]);
        units += step == 4 ? 2 : 1;
        i += step;
    }
    return units;
}

void silk_cef_ime_set(uint32_t id, const uint8_t *text, size_t length, size_t selectionStart,
                      size_t selectionEnd) {
    View *view = input_view(id);
    if (!view) return;
    if (length == 0) {
        silk_cef_ime_cancel(id);
        return;
    }
    view->composing = true;
    cef_string_t composition = make_string((const char *)text, length);
    cef_range_t replacement = {UINT32_MAX, UINT32_MAX};
    cef_range_t selection = {(uint32_t)utf16_offset(text, length, selectionStart),
                             (uint32_t)utf16_offset(text, length, selectionEnd)};
    view->host->ime_set_composition(view->host, &composition, 0, NULL, &replacement, &selection);
    clear_string(&composition);
}

void silk_cef_ime_commit(uint32_t id, const uint8_t *text, size_t length) {
    View *view = input_view(id);
    if (!view) return;
    view->composing = false;
    cef_string_t committed = make_string((const char *)text, length);
    cef_range_t replacement = {UINT32_MAX, UINT32_MAX};
    view->host->ime_commit_text(view->host, &committed, &replacement, 0);
    clear_string(&committed);
}

void silk_cef_ime_cancel(uint32_t id) {
    View *view = input_view(id);
    if (!view || !view->composing) return;
    view->composing = false;
    view->host->ime_cancel_composition(view->host);
}

uint32_t silk_cef_cursor(uint32_t id) {
    View *view = find_view(id);
    return view ? view->cursor : CURSOR_ARROW;
}

uint8_t silk_cef_caret(uint32_t id, double *x, double *y, double *width, double *height) {
    View *view = find_view(id);
    if (!view || !view->hasCaret || !view->focused) return 0;
    *x = view->caretX;
    *y = view->caretY;
    *width = view->caretWidth;
    *height = view->caretHeight;
    return 1;
}

uint8_t silk_cef_frame(uint32_t id, uint8_t popup, SilkCefFrame *out) {
    View *view = find_view(id);
    memset(out, 0, sizeof *out);
    if (!view) return 0;
    Frame *frame = popup ? &view->popup : &view->frame;
    if (popup && !view->popupShown) return 0;
    if (frame->kind == SILK_CEF_FRAME_NONE) return 0;
    out->kind = frame->kind;
    out->width = frame->width;
    out->height = frame->height;
    out->generation = frame->generation;
    out->pixels = frame->kind == SILK_CEF_FRAME_PIXELS ? frame->pixels : NULL;
    out->drmFormat = frame->drmFormat;
    out->drmModifier = frame->drmModifier;
    out->planeCount = frame->planeCount;
    for (uint32_t i = 0; i < frame->planeCount && i < 4; i++) out->planes[i] = frame->planes[i];
    if (popup) {
        out->x = (int32_t)lround(view->popupX * view->scale);
        out->y = (int32_t)lround(view->popupY * view->scale);
        out->shown = 1;
    }
    return 1;
}
