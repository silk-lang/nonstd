// The WebView2 backend of platform/webview (C ABI in ../bridge.h).
//
// Each view is a WebView2 controller inside a clip window, a child of platform-window's Win32
// window, so the page draws over the Silk UI at its hosted node. `place` moves the clip window to
// the node's visible part and the controller's bounds to the node's bounds inside it.
//
// WebView2 starts asynchronously: the environment (once per process), then each view's
// controller, then the DevTools protocol setup that injects the agent script. Commands sent
// before a view is ready wait in its queue and run in order once it is.
//
// WebView2 reports through COM handlers called from the window's message loop (inside
// platform-window's silk_window_next_event, on its pump fiber or the caller's stack). Each report
// queues an event here and calls silk_window_wake, which only sets a flag and posts a message, so
// nextEvent returns and the app drains the queue with takeEvents. Nothing here calls into Silk.
//
// Agent control uses the Chrome DevTools Protocol: the agent script runs in an isolated world of
// its own ("silk-agent"), which pages cannot see, and clicks, keys and wheel turns are
// Input.dispatch* events, which pages get as trusted input.
#ifndef UNICODE
#define UNICODE
#endif
#ifndef _UNICODE
#define _UNICODE
#endif
#define WIN32_LEAN_AND_MEAN
#define COBJMACROS
#define NOMINMAX
#include <windows.h>
#include <objidl.h>
#include <wincodec.h>
#include <math.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wunknown-pragmas"
#include "WebView2.h"
#pragma clang diagnostic pop
#include "../bridge.h"

// platform-window's Win32 bridge (platform/window/native/bridge.h).
void silk_window_wake(void);
uint32_t silk_window_backend(void);
uint32_t silk_window_raw_surface(uint32_t window, void **first, void **second, uint64_t *id);
double silk_window_scale_factor(uint32_t window);
enum { WINDOW_BACKEND_WIN32 = 1, WINDOW_SURFACE_WIN32 = 4 };

// Stand-ins the linker uses when platform-window is not in the program (this package's own unit
// tests): no window system, so `open` reports Unsupported. Like macOS, the package does not
// depend on platform-window; a program with web views has it for its windows.
void silk_webview_no_window_wake(void) {}
uint32_t silk_webview_no_window_backend(void) { return 0; }
uint32_t silk_webview_no_window_raw_surface(uint32_t window, void **first, void **second, uint64_t *id) {
    return 0;
}
double silk_webview_no_window_scale_factor(uint32_t window) { return 1.0; }
#ifdef _MSC_VER
#pragma comment(linker, "/alternatename:silk_window_wake=silk_webview_no_window_wake")
#pragma comment(linker, "/alternatename:silk_window_backend=silk_webview_no_window_backend")
#pragma comment(linker, "/alternatename:silk_window_raw_surface=silk_webview_no_window_raw_surface")
#pragma comment(linker, "/alternatename:silk_window_scale_factor=silk_webview_no_window_scale_factor")
#endif

// Defined here rather than taken from uuid.lib and windowscodecs.lib, which a Silk build on
// Windows does not reliably reach.
static const IID iidUnknown = {0x00000000, 0x0000, 0x0000, {0xC0, 0, 0, 0, 0, 0, 0, 0x46}};
static const CLSID clsidImagingFactory = {0xcacaf262, 0x9370, 0x4615, {0xa1, 0x3b, 0x9f, 0x55, 0x39, 0xda, 0x4c, 0x0a}};
static const IID iidImagingFactory = {0xec5ec8a9, 0xc395, 0x4314, {0x9c, 0x77, 0x54, 0xd7, 0xa9, 0x35, 0xff, 0x70}};
static const GUID formatRgba = {0xf5c7ad2d, 0x6a8d, 0x43dd, {0xa7, 0xa8, 0xa2, 0x99, 0x35, 0x26, 0x1a, 0xe9}};

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

static WCHAR *wide_n(const char *text, size_t length) {
    int count = length ? MultiByteToWideChar(CP_UTF8, 0, text, (int)length, NULL, 0) : 0;
    WCHAR *out = malloc(((size_t)count + 1) * sizeof(WCHAR));
    if (!out) abort();
    if (count) MultiByteToWideChar(CP_UTF8, 0, text, (int)length, out, count);
    out[count] = 0;
    return out;
}

static WCHAR *wide(const char *text) { return wide_n(text, strlen(text)); }

static char *utf8(const WCHAR *text, size_t *length) {
    int count = text && *text ? WideCharToMultiByte(CP_UTF8, 0, text, -1, NULL, 0, NULL, NULL) : 1;
    char *out = malloc(count > 0 ? (size_t)count : 1);
    if (!out) abort();
    out[0] = 0;
    if (text && *text) WideCharToMultiByte(CP_UTF8, 0, text, -1, out, count, NULL, NULL);
    if (length) *length = strlen(out);
    return out;
}

// A string WebView2 allocated, as UTF-8, freeing it.
static char *take_wide(LPWSTR text) {
    char *out = utf8(text, NULL);
    if (text) CoTaskMemFree(text);
    return out;
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
    SilkWebViewEvent event;
    Text texts[2];
} Queued;

static Queued *queue;
static size_t queueHead, queueCount, queueCapacity;
static Text currentTexts[2];

static SilkWebViewEvent blank(uint32_t kind, uint32_t view) {
    SilkWebViewEvent event;
    memset(&event, 0, sizeof event);
    event.kind = kind;
    event.view = view;
    return event;
}

// Queues `event` with up to two strings (copied) and wakes the window's loop.
static void push_texts(SilkWebViewEvent event, const char *first, size_t firstLength,
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
    silk_window_wake();
}

static void push(SilkWebViewEvent event) { push_texts(event, NULL, 0, NULL, 0, 0); }

static void push_text(uint32_t kind, uint32_t view, const char *text) {
    push_texts(blank(kind, view), text, text ? strlen(text) : 0, NULL, 0, 1);
}

static void push_answer(uint32_t kind, uint32_t view, uint32_t request, bool ok, const char *text) {
    SilkWebViewEvent event = blank(kind, view);
    event.request = request;
    if (ok) event.flags |= SILK_WEBVIEW_FLAG_OK;
    push_texts(event, text, text ? strlen(text) : 0, NULL, 0, 1);
}

static void push_progress(uint32_t view, double fraction) {
    SilkWebViewEvent event = blank(SILK_WEBVIEW_LOAD_PROGRESS, view);
    event.value = fraction;
    push(event);
}

uint8_t silk_webview_next_event(SilkWebViewEvent *out) {
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

const uint8_t *silk_webview_event_text(size_t index, size_t *length) {
    if (index >= 2 || !currentTexts[index].bytes) {
        *length = 0;
        return NULL;
    }
    *length = currentTexts[index].length;
    return (const uint8_t *)currentTexts[index].bytes;
}

void silk_webview_queue(uint32_t view, uint32_t kind, uint32_t request, uint32_t flags,
                        const uint8_t *text, size_t length) {
    SilkWebViewEvent event = blank(kind, view);
    event.request = request;
    event.flags = flags;
    push_texts(event, (const char *)text, text ? length : 0, NULL, 0, 1);
}

// ---------------------------------------------------------------------------------------
// COM handlers: one object type for every WebView2 event and completion handler interface.
// Event handlers are Invoke(sender, args); completion handlers are Invoke(HRESULT, result).

typedef struct Handler Handler;
typedef void (*HandlerFn)(Handler *handler, HRESULT status, void *first, void *second);

struct Handler {
    const void *lpVtbl;
    volatile LONG refs;
    const IID *iid;
    HandlerFn fn;
    uint64_t serial; // the view's, 0 for none
    uint32_t request;
    uint32_t operation;
    uint32_t step;
    char *call;  // owned
    char *text;  // owned
    size_t textLength;
    double context; // an execution context id
    bool injected;  // the agent script was injected into that context
    void *data;     // owned COM object, released
};

static HRESULT STDMETHODCALLTYPE handler_query(Handler *self, REFIID iid, void **out) {
    if (IsEqualIID(iid, &iidUnknown) || IsEqualIID(iid, self->iid)) {
        InterlockedIncrement(&self->refs);
        *out = self;
        return S_OK;
    }
    *out = NULL;
    return E_NOINTERFACE;
}

static ULONG STDMETHODCALLTYPE handler_add_ref(Handler *self) {
    return (ULONG)InterlockedIncrement(&self->refs);
}

static ULONG STDMETHODCALLTYPE handler_release(Handler *self) {
    LONG refs = InterlockedDecrement(&self->refs);
    if (refs == 0) {
        free(self->call);
        free(self->text);
        if (self->data) IUnknown_Release((IUnknown *)self->data);
        free(self);
    }
    return (ULONG)refs;
}

static HRESULT STDMETHODCALLTYPE handler_event(Handler *self, IUnknown *sender, IUnknown *args) {
    if (self->fn) self->fn(self, S_OK, sender, args);
    return S_OK;
}

static HRESULT STDMETHODCALLTYPE handler_completed(Handler *self, HRESULT status, void *result) {
    if (self->fn) self->fn(self, status, result, NULL);
    return S_OK;
}

typedef struct EventVtbl {
    HRESULT(STDMETHODCALLTYPE *QueryInterface)(Handler *, REFIID, void **);
    ULONG(STDMETHODCALLTYPE *AddRef)(Handler *);
    ULONG(STDMETHODCALLTYPE *Release)(Handler *);
    HRESULT(STDMETHODCALLTYPE *Invoke)(Handler *, IUnknown *, IUnknown *);
} EventVtbl;

typedef struct CompletedVtbl {
    HRESULT(STDMETHODCALLTYPE *QueryInterface)(Handler *, REFIID, void **);
    ULONG(STDMETHODCALLTYPE *AddRef)(Handler *);
    ULONG(STDMETHODCALLTYPE *Release)(Handler *);
    HRESULT(STDMETHODCALLTYPE *Invoke)(Handler *, HRESULT, void *);
} CompletedVtbl;

static const EventVtbl eventVtbl = {handler_query, handler_add_ref, handler_release, handler_event};
static const CompletedVtbl completedVtbl = {handler_query, handler_add_ref, handler_release,
                                            handler_completed};

static Handler *handler(const IID *iid, bool completion, HandlerFn fn, uint64_t serial) {
    Handler *made = calloc(1, sizeof *made);
    if (!made) abort();
    made->lpVtbl = completion ? (const void *)&completedVtbl : (const void *)&eventVtbl;
    made->refs = 1;
    made->iid = iid;
    made->fn = fn;
    made->serial = serial;
    return made;
}

#define EVENT(iid, fn, serial) handler(&iid, false, fn, serial)
#define COMPLETED(iid, fn, serial) handler(&iid, true, fn, serial)

static void drop_handler(Handler *made) {
    if (made) handler_release(made);
}

// ---------------------------------------------------------------------------------------
// Views.

enum { STARTING, READY, FAILED };

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
    uint32_t request, a, b, c; // operation; button, clickCount, modifiers
    double x, y, dx, dy;
    char *first, *second; // owned
    size_t firstLength, secondLength;
} Op;

// A navigation the app was asked about. WebView2 decides navigations synchronously, so the
// asked one is canceled and, when allowed, started again.
typedef struct Decision {
    uint32_t request;
    char *url;
} Decision;

typedef struct View {
    uint32_t id;
    uint64_t serial;
    uint32_t window;
    HWND parent;
    HWND clip;
    int state;
    uint32_t flags;
    WCHAR *profile;
    ICoreWebView2Controller *controller;
    ICoreWebView2 *webview;
    Op *ops;
    size_t opCount, opCapacity;
    // The last placement, in points.
    bool placed, shows;
    double x0, y0, x1, y1, cx0, cy0, cx1, cy1;
    bool focused;
    bool canGoBack, canGoForward;
    bool skipNextAsk;
    uint32_t nextRequest;
    Decision *decisions;
    size_t decisionCount, decisionCapacity;
    // Navigations canceled to ask about them: their NavigationCompleted is not reported.
    uint64_t canceled[8];
    size_t canceledNext;
    // LoadHtml with a base URL: answered from WebResourceRequested.
    char *html;
    size_t htmlLength;
    WCHAR *htmlBase;
} View;

static View **views;
static size_t viewCount, viewCapacity;
static uint64_t nextSerial = 1;

typedef HRESULT(STDAPICALLTYPE *CreateEnvironmentFn)(PCWSTR, PCWSTR, ICoreWebView2EnvironmentOptions *,
                                                     ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler *);
typedef HRESULT(STDAPICALLTYPE *VersionFn)(PCWSTR, LPWSTR *);

static enum { ENV_NONE, ENV_CREATING, ENV_READY, ENV_FAILED } environmentState;
static ICoreWebView2Environment *environment;
static HRESULT environmentError;
static CreateEnvironmentFn createEnvironment;
static char *agentScript;
static size_t agentScriptLength;
static ATOM clipClass;

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

static void free_op(Op *op) {
    free(op->first);
    free(op->second);
    op->first = op->second = NULL;
}

static double view_scale(View *view) {
    double scale = silk_window_scale_factor(view->window);
    return scale > 0 ? scale : 1.0;
}

// ---------------------------------------------------------------------------------------
// The DevTools protocol.

static void cdp(View *view, const char *method, const char *params, Handler *done) {
    if (!view->webview) {
        drop_handler(done);
        return;
    }
    Handler *answer = done ? done
                           : COMPLETED(IID_ICoreWebView2CallDevToolsProtocolMethodCompletedHandler, NULL, 0);
    WCHAR *wideMethod = wide(method);
    WCHAR *wideParams = wide(params ? params : "{}");
    HRESULT result = ICoreWebView2_CallDevToolsProtocolMethod(
        view->webview, wideMethod, wideParams,
        (ICoreWebView2CallDevToolsProtocolMethodCompletedHandler *)answer);
    free(wideMethod);
    free(wideParams);
    if (FAILED(result) && answer->fn) answer->fn(answer, result, NULL, NULL);
    drop_handler(answer);
}

static Handler *cdp_answer(HandlerFn fn, View *view) {
    return COMPLETED(IID_ICoreWebView2CallDevToolsProtocolMethodCompletedHandler, fn, view->serial);
}

// The protocol's error message in an answer, or a generic one.
static char *cdp_error(HRESULT status, const char *json) {
    const char *message = json ? json_member(json, "message") : NULL;
    char *text = message ? json_string(message, NULL) : NULL;
    if (text) return text;
    char fallback[64];
    snprintf(fallback, sizeof fallback, "DevTools protocol call failed (0x%08lx)", (unsigned long)status);
    return copy_bytes(fallback, strlen(fallback));
}

// The answer of Runtime.evaluate: the string value, or NULL with *error set.
static char *evaluated_string(HRESULT status, const char *json, char **error) {
    *error = NULL;
    if (FAILED(status) || !json) {
        *error = cdp_error(status, json);
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
// Input through the DevTools protocol.

static int cdp_modifiers(uint32_t bits) {
    int flags = 0;
    if (bits & 4) flags |= 1; // Alt
    if (bits & 2) flags |= 2; // Control
    if (bits & 8) flags |= 4; // Meta
    if (bits & 1) flags |= 8; // Shift
    return flags;
}

static void mouse(View *view, const char *type, double x, double y, uint32_t button, int clicks,
                  uint32_t modifiers, double dx, double dy, Handler *done) {
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
                  uint32_t modifiers, Handler *done) {
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
    {"Enter", "Enter", 13, "\r"},       {"Tab", "Tab", 9, NULL},
    {"Backspace", "Backspace", 8, NULL}, {"Escape", "Escape", 27, NULL},
    {"Delete", "Delete", 46, NULL},     {"Home", "Home", 36, NULL},
    {"End", "End", 35, NULL},           {"PageUp", "PageUp", 33, NULL},
    {"PageDown", "PageDown", 34, NULL}, {"ArrowLeft", "ArrowLeft", 37, NULL},
    {"ArrowUp", "ArrowUp", 38, NULL},   {"ArrowRight", "ArrowRight", 39, NULL},
    {"ArrowDown", "ArrowDown", 40, NULL}, {"F1", "F1", 112, NULL},
    {"F2", "F2", 113, NULL},            {"F3", "F3", 114, NULL},
    {"F4", "F4", 115, NULL},            {"F5", "F5", 116, NULL},
    {"F6", "F6", 117, NULL},            {"F7", "F7", 118, NULL},
    {"F8", "F8", 119, NULL},            {"F9", "F9", 120, NULL},
    {"F10", "F10", 121, NULL},          {"F11", "F11", 122, NULL},
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
                const char *text, size_t textLength, uint32_t modifiers, Handler *done) {
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
                            Handler *done) {
    WCHAR units[3] = {0};
    int count = MultiByteToWideChar(CP_UTF8, 0, character, (int)length, units, 2);
    SHORT scan = count == 1 ? VkKeyScanW(units[0]) : -1;
    int virtualKey = scan == -1 ? 0 : (scan & 0xFF);
    char code[16] = {0};
    char c = length == 1 ? character[0] : 0;
    if (c >= 'a' && c <= 'z') snprintf(code, sizeof code, "Key%c", c - 'a' + 'A');
    else if (c >= 'A' && c <= 'Z') snprintf(code, sizeof code, "Key%c", c);
    else if (c >= '0' && c <= '9') snprintf(code, sizeof code, "Digit%c", c);
    else if (c == ' ') snprintf(code, sizeof code, "Space");
    // With Control, Alt or Meta held the press is a shortcut and types nothing.
    bool types = (modifiers & ~1u) == 0;
    if (scan == -1 && types) {
        // Not on the keyboard layout: text input, as an input method gives it.
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

static void type_text(View *view, const char *text, size_t length, Handler *done) {
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
        Handler *then = last ? done : NULL;
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

static void press_key(View *view, const char *name, size_t length, uint32_t modifiers, Handler *done) {
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
    if (view->controller && !view->focused)
        ICoreWebView2Controller_MoveFocus(view->controller, COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
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

static void agent_step(Handler *self, HRESULT status, void *result, void *unused);

static void agent_fail(View *view, Handler *self, const char *reason) {
    if (self->operation == SILK_WEBVIEW_AGENT_SNAPSHOT) {
        SilkWebViewEvent event = blank(SILK_WEBVIEW_SNAPSHOT, view->id);
        event.request = self->request;
        push_texts(event, "", 0, NULL, 0, 1);
    } else {
        push_answer(SILK_WEBVIEW_ACTION_RESULT, view->id, self->request, false, reason);
    }
}

static Handler *agent_next(Handler *self, View *view, uint32_t step) {
    Handler *next = cdp_answer(agent_step, view);
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

static void agent_evaluate(View *view, Handler *self, const char *expression, size_t length,
                           uint32_t step) {
    Buffer params = {0};
    buffer_text(&params, "{\"expression\":");
    buffer_json(&params, expression, length);
    buffer_format(&params, ",\"contextId\":%.0f", self->context);
    buffer_text(&params, ",\"returnByValue\":true,\"awaitPromise\":true}");
    cdp(view, "Runtime.evaluate", params.data, agent_next(self, view, step));
    buffer_free(&params);
}

static void action_done(Handler *self, HRESULT status, void *result, void *unused) {
    View *view = find_serial(self->serial);
    if (!view) return;
    push_answer(SILK_WEBVIEW_ACTION_RESULT, view->id, self->request, SUCCEEDED(status),
                SUCCEEDED(status) ? "" : "the input did not reach the page");
}

// `value` is the call's JSON text: the outline as a JSON string, or a location object.
static void agent_act(View *view, Handler *self, const char *value) {
    if (self->operation == SILK_WEBVIEW_AGENT_SNAPSHOT) {
        size_t length = 0;
        char *outline = json_string(value, &length);
        SilkWebViewEvent event = blank(SILK_WEBVIEW_SNAPSHOT, view->id);
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
    Handler *done = cdp_answer(action_done, view);
    done->request = self->request;
    // A click into the page gives it keyboard focus, as a person's click does.
    take_keyboard(view);
    if (self->operation == SILK_WEBVIEW_AGENT_CLICK) {
        click(view, x, y, 0, 1, 0, done);
    } else if (self->textLength) {
        type_text(view, self->text, self->textLength, done);
    } else {
        press_key(view, "Delete", 6, 0, done);
    }
}

static void agent_step(Handler *self, HRESULT status, void *result, void *unused) {
    View *view = find_serial(self->serial);
    if (!view) return;
    char *json = utf8((const WCHAR *)result, NULL);
    if (FAILED(status) && self->step != AGENT_INJECTED) {
        char *error = cdp_error(status, json);
        agent_fail(view, self, error);
        free(error);
        free(json);
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
        char *value = evaluated_string(status, json, &error);
        if (!value) {
            agent_fail(view, self, error);
            free(error);
            break;
        }
        bool missing = (self->operation == SILK_WEBVIEW_AGENT_SNAPSHOT && strcmp(value, "null") == 0) ||
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
    free(json);
}

// ---------------------------------------------------------------------------------------
// Scripts in the page's own world.

static void evaluate_done(Handler *self, HRESULT status, void *result, void *unused) {
    View *view = find_serial(self->serial);
    if (!view) return;
    char *json = utf8((const WCHAR *)result, NULL);
    char *error = NULL;
    char *value = evaluated_string(status, json, &error);
    push_answer(SILK_WEBVIEW_SCRIPT_RESULT, view->id, self->request, value != NULL,
                value ? value : error);
    free(value);
    free(error);
    free(json);
}

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
    Handler *done = cdp_answer(evaluate_done, view);
    done->request = request;
    cdp(view, "Runtime.evaluate", params.data, done);
    buffer_free(&expression);
    buffer_free(&params);
}

// ---------------------------------------------------------------------------------------
// Screenshots: CapturePreview's PNG, decoded with WIC.

static uint8_t *decode_png(IStream *stream, UINT *width, UINT *height) {
    *width = *height = 0;
    LARGE_INTEGER zero;
    zero.QuadPart = 0;
    if (FAILED(IStream_Seek(stream, zero, STREAM_SEEK_SET, NULL))) return NULL;
    IWICImagingFactory *factory = NULL;
    IWICBitmapDecoder *decoder = NULL;
    IWICBitmapFrameDecode *frame = NULL;
    IWICFormatConverter *converter = NULL;
    uint8_t *pixels = NULL;
    if (FAILED(CoCreateInstance(&clsidImagingFactory, NULL, CLSCTX_INPROC_SERVER, &iidImagingFactory,
                                (void **)&factory)))
        goto done;
    if (FAILED(IWICImagingFactory_CreateDecoderFromStream(factory, stream, NULL,
                                                          WICDecodeMetadataCacheOnDemand, &decoder)))
        goto done;
    if (FAILED(IWICBitmapDecoder_GetFrame(decoder, 0, &frame))) goto done;
    if (FAILED(IWICImagingFactory_CreateFormatConverter(factory, &converter))) goto done;
    // Straight (not premultiplied) RGBA, rows top first, as the contract has it.
    if (FAILED(IWICFormatConverter_Initialize(converter, (IWICBitmapSource *)frame, &formatRgba,
                                              WICBitmapDitherTypeNone, NULL, 0.0,
                                              WICBitmapPaletteTypeCustom)))
        goto done;
    UINT w = 0, h = 0;
    if (FAILED(IWICFormatConverter_GetSize(converter, &w, &h)) || w == 0 || h == 0) goto done;
    pixels = malloc((size_t)w * h * 4);
    if (!pixels) abort();
    if (FAILED(IWICFormatConverter_CopyPixels(converter, NULL, w * 4, w * h * 4, pixels))) {
        free(pixels);
        pixels = NULL;
        goto done;
    }
    *width = w;
    *height = h;
done:
    if (converter) IWICFormatConverter_Release(converter);
    if (frame) IWICBitmapFrameDecode_Release(frame);
    if (decoder) IWICBitmapDecoder_Release(decoder);
    if (factory) IWICImagingFactory_Release(factory);
    return pixels;
}

// ICoreWebView2CapturePreviewCompletedHandler's Invoke takes only the HRESULT; the completion
// vtable's unused second argument is never read.
static void screenshot_done(Handler *self, HRESULT status, void *unused, void *unused2) {
    View *view = find_serial(self->serial);
    if (!view) return;
    SilkWebViewEvent event = blank(SILK_WEBVIEW_SCREENSHOT, view->id);
    event.request = self->request;
    UINT width = 0, height = 0;
    uint8_t *pixels = SUCCEEDED(status) ? decode_png((IStream *)self->data, &width, &height) : NULL;
    event.width = width;
    event.height = height;
    push_texts(event, (const char *)pixels, pixels ? (size_t)width * height * 4 : 0, NULL, 0, 1);
    free(pixels);
}

static void run_screenshot(View *view, uint32_t request) {
    IStream *stream = NULL;
    if (FAILED(CreateStreamOnHGlobal(NULL, TRUE, &stream)) || !stream) {
        SilkWebViewEvent event = blank(SILK_WEBVIEW_SCREENSHOT, view->id);
        event.request = request;
        push_texts(event, "", 0, NULL, 0, 1);
        return;
    }
    Handler *done = COMPLETED(IID_ICoreWebView2CapturePreviewCompletedHandler, screenshot_done, view->serial);
    done->request = request;
    done->data = stream; // the handler releases it
    HRESULT result = ICoreWebView2_CapturePreview(view->webview, COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG,
                                                  stream, (ICoreWebView2CapturePreviewCompletedHandler *)done);
    if (FAILED(result)) screenshot_done(done, result, NULL, NULL);
    drop_handler(done);
}

// ---------------------------------------------------------------------------------------
// Running commands.

static void run_op(View *view, Op *op) {
    switch (op->kind) {
    case OP_NAVIGATE: {
        WCHAR *url = wide_n(op->first, op->firstLength);
        HRESULT result = ICoreWebView2_Navigate(view->webview, url);
        free(url);
        if (FAILED(result)) {
            push_texts(blank(SILK_WEBVIEW_LOAD_FINISHED, view->id), op->first, op->firstLength,
                       "not a URL", 9, 2);
        }
        break;
    }
    case OP_LOAD_HTML: {
        view->skipNextAsk = true;
        if (op->secondLength == 0) {
            WCHAR *html = wide_n(op->first, op->firstLength);
            ICoreWebView2_NavigateToString(view->webview, html);
            free(html);
            break;
        }
        // NavigateToString has no base URL: navigate to the base URL and answer that request with
        // the HTML (see web_resource_requested).
        if (view->htmlBase) {
            ICoreWebView2_RemoveWebResourceRequestedFilter(view->webview, view->htmlBase,
                                                           COREWEBVIEW2_WEB_RESOURCE_CONTEXT_DOCUMENT);
            free(view->htmlBase);
        }
        free(view->html);
        view->html = copy_bytes(op->first, op->firstLength);
        view->htmlLength = op->firstLength;
        view->htmlBase = wide_n(op->second, op->secondLength);
        ICoreWebView2_AddWebResourceRequestedFilter(view->webview, view->htmlBase,
                                                    COREWEBVIEW2_WEB_RESOURCE_CONTEXT_DOCUMENT);
        if (FAILED(ICoreWebView2_Navigate(view->webview, view->htmlBase))) {
            push_texts(blank(SILK_WEBVIEW_LOAD_FINISHED, view->id), op->second, op->secondLength,
                       "not a URL", 9, 2);
        }
        break;
    }
    case OP_GO:
        switch (op->a) {
        case SILK_WEBVIEW_BACK: ICoreWebView2_GoBack(view->webview); break;
        case SILK_WEBVIEW_FORWARD: ICoreWebView2_GoForward(view->webview); break;
        case SILK_WEBVIEW_RELOAD: ICoreWebView2_Reload(view->webview); break;
        default: ICoreWebView2_Stop(view->webview); break;
        }
        break;
    case OP_ZOOM:
        if (op->x > 0) ICoreWebView2Controller_put_ZoomFactor(view->controller, op->x);
        break;
    case OP_FOCUS:
        ICoreWebView2Controller_MoveFocus(view->controller, COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
        break;
    case OP_EVALUATE:
        run_evaluate(view, op->request, op->first, op->firstLength);
        break;
    case OP_AGENT: {
        Handler *start = cdp_answer(agent_step, view);
        start->request = op->request;
        start->operation = op->a;
        start->step = AGENT_FRAME;
        start->call = copy_bytes(op->first, op->firstLength);
        start->text = copy_bytes(op->second ? op->second : "", op->secondLength);
        start->textLength = op->secondLength;
        cdp(view, "Page.getFrameTree", "{}", start);
        break;
    }
    case OP_SCREENSHOT:
        run_screenshot(view, op->request);
        break;
    case OP_CLICK:
        if (op->a == 0) take_keyboard(view);
        click(view, op->x, op->y, op->a, op->b, op->c, NULL);
        break;
    case OP_MOVE:
        mouse(view, "mouseMoved", op->x, op->y, 0, 0, op->c, 0, 0, NULL);
        break;
    case OP_SCROLL:
        mouse(view, "mouseWheel", op->x, op->y, 0, 0, op->c, op->dx, op->dy, NULL);
        break;
    case OP_TYPE:
        take_keyboard(view);
        type_text(view, op->first, op->firstLength, NULL);
        break;
    case OP_KEY:
        take_keyboard(view);
        press_key(view, op->first, op->firstLength, op->c, NULL);
        break;
    case OP_DEVTOOLS:
        ICoreWebView2_OpenDevToolsWindow(view->webview);
        break;
    }
}

// Answers a command whose view could not start.
static void fail_op(View *view, Op *op) {
    switch (op->kind) {
    case OP_EVALUATE:
        push_answer(SILK_WEBVIEW_SCRIPT_RESULT, view->id, op->request, false, "the web view did not start");
        break;
    case OP_AGENT:
        if (op->a == SILK_WEBVIEW_AGENT_SNAPSHOT) {
            SilkWebViewEvent event = blank(SILK_WEBVIEW_SNAPSHOT, view->id);
            event.request = op->request;
            push_texts(event, "", 0, NULL, 0, 1);
        } else {
            push_answer(SILK_WEBVIEW_ACTION_RESULT, view->id, op->request, false, "the web view did not start");
        }
        break;
    case OP_SCREENSHOT: {
        SilkWebViewEvent event = blank(SILK_WEBVIEW_SCREENSHOT, view->id);
        event.request = op->request;
        push_texts(event, "", 0, NULL, 0, 1);
        break;
    }
    default:
        break;
    }
}

// Runs `op` now when the view is ready, or keeps it until it is. Takes the op's strings.
static void submit(View *view, Op op) {
    if (view->state == STARTING) {
        if (view->opCount == view->opCapacity) {
            size_t capacity = view->opCapacity ? view->opCapacity * 2 : 8;
            Op *grown = realloc(view->ops, capacity * sizeof *grown);
            if (!grown) abort();
            view->ops = grown;
            view->opCapacity = capacity;
        }
        view->ops[view->opCount++] = op;
        return;
    }
    if (view->state == READY) run_op(view, &op);
    else fail_op(view, &op);
    free_op(&op);
}

static Op op_of(OpKind kind) {
    Op op;
    memset(&op, 0, sizeof op);
    op.kind = kind;
    return op;
}

static void op_texts(Op *op, const uint8_t *first, size_t firstLength, const uint8_t *second,
                     size_t secondLength) {
    op->first = copy_bytes(first ? (const char *)first : "", first ? firstLength : 0);
    op->firstLength = first ? firstLength : 0;
    op->second = copy_bytes(second ? (const char *)second : "", second ? secondLength : 0);
    op->secondLength = second ? secondLength : 0;
}

// ---------------------------------------------------------------------------------------
// Engine events.

static void set_focused(View *view, bool focused) {
    if (view->focused == focused) return;
    view->focused = focused;
    SilkWebViewEvent event = blank(SILK_WEBVIEW_FOCUS_CHANGED, view->id);
    if (focused) event.flags |= SILK_WEBVIEW_FLAG_OK;
    push(event);
}

static char *source_of(View *view) {
    LPWSTR source = NULL;
    if (!view->webview || FAILED(ICoreWebView2_get_Source(view->webview, &source))) source = NULL;
    return take_wide(source);
}

static void push_load_started(View *view, const char *url) {
    push_text(SILK_WEBVIEW_LOAD_STARTED, view->id, url);
    push_progress(view->id, 0.1);
}

static void navigation_starting(Handler *self, HRESULT status, void *sender, void *argument) {
    View *view = find_serial(self->serial);
    if (!view) return;
    ICoreWebView2NavigationStartingEventArgs *args = argument;
    LPWSTR uri = NULL;
    ICoreWebView2NavigationStartingEventArgs_get_Uri(args, &uri);
    char *url = take_wide(uri);
    BOOL user = FALSE;
    ICoreWebView2NavigationStartingEventArgs_get_IsUserInitiated(args, &user);
    bool ask = (view->flags & SILK_WEBVIEW_ASK_BEFORE_NAVIGATING) != 0;
    ICoreWebView2NavigationStartingEventArgs3 *third = NULL;
    if (SUCCEEDED(ICoreWebView2NavigationStartingEventArgs_QueryInterface(
            args, &IID_ICoreWebView2NavigationStartingEventArgs3, (void **)&third)) && third) {
        COREWEBVIEW2_NAVIGATION_KIND kind = COREWEBVIEW2_NAVIGATION_KIND_NEW_DOCUMENT;
        ICoreWebView2NavigationStartingEventArgs3_get_NavigationKind(third, &kind);
        // Back, forward and reload are never asked about.
        if (kind != COREWEBVIEW2_NAVIGATION_KIND_NEW_DOCUMENT) ask = false;
        ICoreWebView2NavigationStartingEventArgs3_Release(third);
    }
    if (view->skipNextAsk) {
        // LoadHtml is the client's own page, never asked about.
        view->skipNextAsk = false;
        ask = false;
    }
    if (ask) {
        ICoreWebView2NavigationStartingEventArgs_put_Cancel(args, TRUE);
        UINT64 navigation = 0;
        ICoreWebView2NavigationStartingEventArgs_get_NavigationId(args, &navigation);
        view->canceled[view->canceledNext++ % 8] = navigation;
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
        push_answer(SILK_WEBVIEW_NAVIGATION_REQUESTED, view->id, decision->request, user != FALSE, url);
        return;
    }
    push_load_started(view, url);
    free(url);
}

static void content_loading(Handler *self, HRESULT status, void *sender, void *args) {
    View *view = find_serial(self->serial);
    if (view) push_progress(view->id, 0.4);
}

static void dom_content_loaded(Handler *self, HRESULT status, void *sender, void *args) {
    View *view = find_serial(self->serial);
    if (view) push_progress(view->id, 0.8);
}

static const char *web_error_text(COREWEBVIEW2_WEB_ERROR_STATUS status) {
    switch (status) {
    case COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_COMMON_NAME_IS_INCORRECT: return "the certificate's name does not match the host";
    case COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_EXPIRED: return "the certificate has expired";
    case COREWEBVIEW2_WEB_ERROR_STATUS_CLIENT_CERTIFICATE_CONTAINS_ERRORS: return "the client certificate has errors";
    case COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_REVOKED: return "the certificate was revoked";
    case COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_IS_INVALID: return "the certificate is not valid";
    case COREWEBVIEW2_WEB_ERROR_STATUS_SERVER_UNREACHABLE: return "the server is unreachable";
    case COREWEBVIEW2_WEB_ERROR_STATUS_TIMEOUT: return "the connection timed out";
    case COREWEBVIEW2_WEB_ERROR_STATUS_ERROR_HTTP_INVALID_SERVER_RESPONSE: return "the server's response was not valid";
    case COREWEBVIEW2_WEB_ERROR_STATUS_CONNECTION_ABORTED: return "the connection was aborted";
    case COREWEBVIEW2_WEB_ERROR_STATUS_CONNECTION_RESET: return "the connection was reset";
    case COREWEBVIEW2_WEB_ERROR_STATUS_DISCONNECTED: return "the network is disconnected";
    case COREWEBVIEW2_WEB_ERROR_STATUS_CANNOT_CONNECT: return "could not connect to the server";
    case COREWEBVIEW2_WEB_ERROR_STATUS_HOST_NAME_NOT_RESOLVED: return "the host name could not be resolved";
    case COREWEBVIEW2_WEB_ERROR_STATUS_OPERATION_CANCELED: return "the navigation was canceled";
    case COREWEBVIEW2_WEB_ERROR_STATUS_REDIRECT_FAILED: return "a redirect failed";
    case COREWEBVIEW2_WEB_ERROR_STATUS_VALID_AUTHENTICATION_CREDENTIALS_REQUIRED: return "the server asks for credentials";
    case COREWEBVIEW2_WEB_ERROR_STATUS_VALID_PROXY_AUTHENTICATION_REQUIRED: return "the proxy asks for credentials";
    default: return "the page did not load";
    }
}

static void navigation_completed(Handler *self, HRESULT status, void *sender, void *argument) {
    View *view = find_serial(self->serial);
    if (!view) return;
    ICoreWebView2NavigationCompletedEventArgs *args = argument;
    UINT64 navigation = 0;
    ICoreWebView2NavigationCompletedEventArgs_get_NavigationId(args, &navigation);
    for (size_t i = 0; i < 8; i++) {
        if (navigation != 0 && view->canceled[i] == navigation) {
            view->canceled[i] = 0;
            return;
        }
    }
    BOOL ok = FALSE;
    ICoreWebView2NavigationCompletedEventArgs_get_IsSuccess(args, &ok);
    COREWEBVIEW2_WEB_ERROR_STATUS error = COREWEBVIEW2_WEB_ERROR_STATUS_UNKNOWN;
    if (!ok) ICoreWebView2NavigationCompletedEventArgs_get_WebErrorStatus(args, &error);
    char *url = source_of(view);
    const char *reason = ok ? "" : web_error_text(error);
    push_progress(view->id, 1.0);
    SilkWebViewEvent event = blank(SILK_WEBVIEW_LOAD_FINISHED, view->id);
    if (ok) event.flags |= SILK_WEBVIEW_FLAG_OK;
    push_texts(event, url, strlen(url), reason, strlen(reason), 2);
    free(url);
}

static void source_changed(Handler *self, HRESULT status, void *sender, void *args) {
    View *view = find_serial(self->serial);
    if (!view) return;
    char *url = source_of(view);
    push_text(SILK_WEBVIEW_URL_CHANGED, view->id, url);
    free(url);
}

static void title_changed(Handler *self, HRESULT status, void *sender, void *args) {
    View *view = find_serial(self->serial);
    if (!view) return;
    LPWSTR title = NULL;
    ICoreWebView2_get_DocumentTitle(view->webview, &title);
    char *text = take_wide(title);
    push_text(SILK_WEBVIEW_TITLE_CHANGED, view->id, text);
    free(text);
}

static void history_changed(Handler *self, HRESULT status, void *sender, void *args) {
    View *view = find_serial(self->serial);
    if (!view) return;
    BOOL back = FALSE, forward = FALSE;
    ICoreWebView2_get_CanGoBack(view->webview, &back);
    ICoreWebView2_get_CanGoForward(view->webview, &forward);
    if ((back != FALSE) == view->canGoBack && (forward != FALSE) == view->canGoForward) return;
    view->canGoBack = back != FALSE;
    view->canGoForward = forward != FALSE;
    SilkWebViewEvent event = blank(SILK_WEBVIEW_HISTORY_CHANGED, view->id);
    if (view->canGoBack) event.flags |= SILK_WEBVIEW_FLAG_OK;
    if (view->canGoForward) event.flags |= SILK_WEBVIEW_FLAG_SECOND;
    push(event);
}

// New windows are the app's call: report and open nothing.
static void new_window_requested(Handler *self, HRESULT status, void *sender, void *argument) {
    View *view = find_serial(self->serial);
    if (!view) return;
    ICoreWebView2NewWindowRequestedEventArgs *args = argument;
    ICoreWebView2NewWindowRequestedEventArgs_put_Handled(args, TRUE);
    LPWSTR uri = NULL;
    ICoreWebView2NewWindowRequestedEventArgs_get_Uri(args, &uri);
    char *url = take_wide(uri);
    push_text(SILK_WEBVIEW_NEW_WINDOW_REQUESTED, view->id, url);
    free(url);
}

static void process_failed(Handler *self, HRESULT status, void *sender, void *argument) {
    View *view = find_serial(self->serial);
    if (!view) return;
    ICoreWebView2ProcessFailedEventArgs *args = argument;
    COREWEBVIEW2_PROCESS_FAILED_KIND kind = COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED;
    ICoreWebView2ProcessFailedEventArgs_get_ProcessFailedKind(args, &kind);
    // Other processes (GPU, utilities) restart on their own and the page goes on.
    switch (kind) {
    case COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED:
        push_text(SILK_WEBVIEW_CRASHED, view->id, "the page's renderer process ended");
        break;
    case COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE:
        push_text(SILK_WEBVIEW_CRASHED, view->id, "the page's renderer process stopped responding");
        break;
    case COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED:
        push_text(SILK_WEBVIEW_CRASHED, view->id, "the WebView2 browser process ended");
        break;
    default:
        break;
    }
}

static const char consolePrefix[] = "\001silk-console:";

static void web_message_received(Handler *self, HRESULT status, void *sender, void *argument) {
    View *view = find_serial(self->serial);
    if (!view) return;
    ICoreWebView2WebMessageReceivedEventArgs *args = argument;
    LPWSTR message = NULL;
    if (FAILED(ICoreWebView2WebMessageReceivedEventArgs_TryGetWebMessageAsString(args, &message))) return;
    char *text = take_wide(message);
    size_t prefix = sizeof consolePrefix - 1;
    if (strncmp(text, consolePrefix, prefix) == 0 && text[prefix] >= '0' && text[prefix] <= '4' &&
        text[prefix + 1] == ':') {
        SilkWebViewEvent event = blank(SILK_WEBVIEW_CONSOLE, view->id);
        event.level = (uint32_t)(text[prefix] - '0');
        const char *body = text + prefix + 2;
        push_texts(event, body, strlen(body), NULL, 0, 1);
    }
    free(text);
}

static void web_resource_requested(Handler *self, HRESULT status, void *sender, void *argument) {
    View *view = find_serial(self->serial);
    if (!view || !view->html || !environment) return;
    ICoreWebView2WebResourceRequestedEventArgs *args = argument;
    IStream *stream = NULL;
    if (SUCCEEDED(CreateStreamOnHGlobal(NULL, TRUE, &stream)) && stream) {
        ULONG written = 0;
        IStream_Write(stream, view->html, (ULONG)view->htmlLength, &written);
        LARGE_INTEGER zero;
        zero.QuadPart = 0;
        IStream_Seek(stream, zero, STREAM_SEEK_SET, NULL);
        ICoreWebView2WebResourceResponse *response = NULL;
        if (SUCCEEDED(ICoreWebView2Environment_CreateWebResourceResponse(
                environment, stream, 200, L"OK", L"Content-Type: text/html; charset=utf-8", &response)) &&
            response) {
            ICoreWebView2WebResourceRequestedEventArgs_put_Response(args, response);
            ICoreWebView2WebResourceResponse_Release(response);
        }
        IStream_Release(stream);
    }
    ICoreWebView2_RemoveWebResourceRequestedFilter(view->webview, view->htmlBase,
                                                   COREWEBVIEW2_WEB_RESOURCE_CONTEXT_DOCUMENT);
    free(view->html);
    free(view->htmlBase);
    view->html = NULL;
    view->htmlBase = NULL;
    view->htmlLength = 0;
}

static void got_focus(Handler *self, HRESULT status, void *sender, void *args) {
    View *view = find_serial(self->serial);
    if (view) set_focused(view, true);
}

static void lost_focus(Handler *self, HRESULT status, void *sender, void *args) {
    View *view = find_serial(self->serial);
    if (view) set_focused(view, false);
}

// ---------------------------------------------------------------------------------------
// Starting: the environment, each view's controller, then the agent script.

// Wraps console.* and reports errors and unhandled rejections through the host's web message
// channel (window.chrome.webview), in the main frame.
static const char consoleScript[] =
    "(() => {\n"
    "  const host = window.chrome && window.chrome.webview;\n"
    "  if (!host || window !== window.top) return;\n"
    "  const text = value => {\n"
    "    if (typeof value === 'string') return value;\n"
    "    if (value instanceof Error) return String(value.stack || value);\n"
    "    try { const json = JSON.stringify(value); return json === undefined ? String(value) : json; }\n"
    "    catch (e) { return String(value); }\n"
    "  };\n"
    "  const send = (level, args) => {\n"
    "    try { host.postMessage('\\u0001silk-console:' + level + ':' + Array.from(args, text).join(' ')); } catch (e) {}\n"
    "  };\n"
    "  [['debug', 0], ['log', 1], ['info', 2], ['warn', 3], ['error', 4]].forEach(([name, level]) => {\n"
    "    const original = console[name];\n"
    "    console[name] = function (...args) { send(level, args); return original.apply(this, args); };\n"
    "  });\n"
    "  window.addEventListener('error', event => send(4, [event.message]));\n"
    "  window.addEventListener('unhandledrejection', event => send(4, ['Unhandled rejection:', event.reason]));\n"
    "})();";

static void apply_placement(View *view);

static void start_failed(View *view, HRESULT status, const char *what) {
    view->state = FAILED;
    char reason[160];
    snprintf(reason, sizeof reason, "%s (HRESULT 0x%08lx)", what, (unsigned long)status);
    push_text(SILK_WEBVIEW_CRASHED, view->id, reason);
    for (size_t i = 0; i < view->opCount; i++) {
        fail_op(view, &view->ops[i]);
        free_op(&view->ops[i]);
    }
    view->opCount = 0;
}

static void view_ready(Handler *self, HRESULT status, void *result, void *unused) {
    View *view = find_serial(self->serial);
    if (!view || view->state != STARTING) return;
    // Even when the protocol refused the script, agent commands inject it on first use.
    view->state = READY;
    push(blank(SILK_WEBVIEW_CREATED, view->id));
    apply_placement(view);
    // Commands sent while starting, in order. Running one may close the view.
    uint64_t serial = view->serial;
    for (size_t i = 0; i < view->opCount; i++) {
        if (find_serial(serial) == view) run_op(view, &view->ops[i]);
        free_op(&view->ops[i]);
    }
    if (find_serial(serial) == view) view->opCount = 0;
}

#define LISTEN(object, event, iid, fn)                                                     \
    do {                                                                                   \
        EventRegistrationToken token;                                                      \
        Handler *made = EVENT(iid, fn, view->serial);                                      \
        object##_add_##event(target, (void *)made, &token);                                \
        drop_handler(made);                                                                \
    } while (0)

static void set_up(View *view) {
    ICoreWebView2 *target = view->webview;
    ICoreWebView2Settings *settings = NULL;
    if (SUCCEEDED(ICoreWebView2_get_Settings(target, &settings)) && settings) {
        ICoreWebView2Settings_put_AreDevToolsEnabled(settings, (view->flags & SILK_WEBVIEW_INSPECTABLE) != 0);
        ICoreWebView2Settings_Release(settings);
    }
    if (view->flags & SILK_WEBVIEW_TRANSPARENT) {
        ICoreWebView2Controller2 *second = NULL;
        if (SUCCEEDED(ICoreWebView2Controller_QueryInterface(view->controller, &IID_ICoreWebView2Controller2,
                                                             (void **)&second)) && second) {
            COREWEBVIEW2_COLOR clear = {0, 0, 0, 0};
            ICoreWebView2Controller2_put_DefaultBackgroundColor(second, clear);
            ICoreWebView2Controller2_Release(second);
        }
    }
    LISTEN(ICoreWebView2, NavigationStarting, IID_ICoreWebView2NavigationStartingEventHandler, navigation_starting);
    LISTEN(ICoreWebView2, ContentLoading, IID_ICoreWebView2ContentLoadingEventHandler, content_loading);
    LISTEN(ICoreWebView2, NavigationCompleted, IID_ICoreWebView2NavigationCompletedEventHandler, navigation_completed);
    LISTEN(ICoreWebView2, SourceChanged, IID_ICoreWebView2SourceChangedEventHandler, source_changed);
    LISTEN(ICoreWebView2, DocumentTitleChanged, IID_ICoreWebView2DocumentTitleChangedEventHandler, title_changed);
    LISTEN(ICoreWebView2, HistoryChanged, IID_ICoreWebView2HistoryChangedEventHandler, history_changed);
    LISTEN(ICoreWebView2, NewWindowRequested, IID_ICoreWebView2NewWindowRequestedEventHandler, new_window_requested);
    LISTEN(ICoreWebView2, ProcessFailed, IID_ICoreWebView2ProcessFailedEventHandler, process_failed);
    LISTEN(ICoreWebView2, WebMessageReceived, IID_ICoreWebView2WebMessageReceivedEventHandler, web_message_received);
    LISTEN(ICoreWebView2, WebResourceRequested, IID_ICoreWebView2WebResourceRequestedEventHandler, web_resource_requested);
    ICoreWebView2_2 *second = NULL;
    if (SUCCEEDED(ICoreWebView2_QueryInterface(target, &IID_ICoreWebView2_2, (void **)&second)) && second) {
        EventRegistrationToken token;
        Handler *made = EVENT(IID_ICoreWebView2DOMContentLoadedEventHandler, dom_content_loaded, view->serial);
        ICoreWebView2_2_add_DOMContentLoaded(second, (ICoreWebView2DOMContentLoadedEventHandler *)made, &token);
        drop_handler(made);
        ICoreWebView2_2_Release(second);
    }
    {
        EventRegistrationToken token;
        Handler *made = EVENT(IID_ICoreWebView2FocusChangedEventHandler, got_focus, view->serial);
        ICoreWebView2Controller_add_GotFocus(view->controller, (ICoreWebView2FocusChangedEventHandler *)made, &token);
        drop_handler(made);
        made = EVENT(IID_ICoreWebView2FocusChangedEventHandler, lost_focus, view->serial);
        ICoreWebView2Controller_add_LostFocus(view->controller, (ICoreWebView2FocusChangedEventHandler *)made, &token);
        drop_handler(made);
    }
    WCHAR *console = wide(consoleScript);
    Handler *added = COMPLETED(IID_ICoreWebView2AddScriptToExecuteOnDocumentCreatedCompletedHandler, NULL, 0);
    ICoreWebView2_AddScriptToExecuteOnDocumentCreated(
        target, console, (ICoreWebView2AddScriptToExecuteOnDocumentCreatedCompletedHandler *)added);
    drop_handler(added);
    free(console);
    apply_placement(view);

    // The agent script, in an isolated world of its own, before any page of this view loads:
    // the view is ready once the protocol has it.
    cdp(view, "Page.enable", "{}", NULL);
    Buffer params = {0};
    buffer_text(&params, "{\"source\":");
    buffer_json(&params, agentScript ? agentScript : "", agentScript ? agentScriptLength : 0);
    buffer_text(&params, ",\"worldName\":");
    buffer_json(&params, agentWorld, strlen(agentWorld));
    buffer_text(&params, "}");
    cdp(view, "Page.addScriptToEvaluateOnNewDocument", params.data, cdp_answer(view_ready, view));
    buffer_free(&params);
}

static void controller_created(Handler *self, HRESULT status, void *result, void *unused) {
    ICoreWebView2Controller *controller = result;
    View *view = find_serial(self->serial);
    if (!view) {
        // Closed while starting.
        if (controller) ICoreWebView2Controller_Close(controller);
        return;
    }
    if (view->state != STARTING) return;
    if (FAILED(status) || !controller) {
        start_failed(view, status, "WebView2 could not create the view");
        return;
    }
    ICoreWebView2Controller_AddRef(controller);
    view->controller = controller;
    if (FAILED(ICoreWebView2Controller_get_CoreWebView2(controller, &view->webview)) || !view->webview) {
        start_failed(view, E_FAIL, "WebView2 gave no web view");
        return;
    }
    set_up(view);
}

// A profile name WebView2 accepts (letters, digits and a few symbols, at most 64 characters),
// kept distinct from other names by a hash when it had to change.
static WCHAR *profile_name(const char *name, size_t length) {
    char clean[65];
    size_t used = 0;
    bool changed = length > 40;
    uint64_t hash = 1469598103934665603ULL;
    for (size_t i = 0; i < length; i++) {
        unsigned char c = (unsigned char)name[i];
        hash = (hash ^ c) * 1099511628211ULL;
        bool allowed = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') ||
                       strchr("#@$()+-_~. ", c) != NULL;
        if (!allowed) changed = true;
        if (used < 40) clean[used++] = allowed ? (char)c : '_';
    }
    if (changed) used += (size_t)snprintf(clean + used, sizeof clean - used, "-%016llx", (unsigned long long)hash);
    clean[used] = 0;
    return wide(clean);
}

static void create_controller(View *view) {
    Handler *done = COMPLETED(IID_ICoreWebView2CreateCoreWebView2ControllerCompletedHandler,
                              controller_created, view->serial);
    HRESULT result = E_NOINTERFACE;
    ICoreWebView2Environment10 *tenth = NULL;
    if (SUCCEEDED(ICoreWebView2Environment_QueryInterface(environment, &IID_ICoreWebView2Environment10,
                                                          (void **)&tenth)) && tenth) {
        ICoreWebView2ControllerOptions *options = NULL;
        if (SUCCEEDED(ICoreWebView2Environment10_CreateCoreWebView2ControllerOptions(tenth, &options)) && options) {
            // A named profile keeps its cookies and storage; no name is an InPrivate session that
            // forgets everything.
            if (view->profile) ICoreWebView2ControllerOptions_put_ProfileName(options, view->profile);
            ICoreWebView2ControllerOptions_put_IsInPrivateModeEnabled(options, view->profile ? FALSE : TRUE);
            result = ICoreWebView2Environment10_CreateCoreWebView2ControllerWithOptions(
                tenth, view->clip, options, (ICoreWebView2CreateCoreWebView2ControllerCompletedHandler *)done);
            ICoreWebView2ControllerOptions_Release(options);
        }
        ICoreWebView2Environment10_Release(tenth);
    }
    if (result == E_NOINTERFACE) {
        // A runtime older than profiles (before 101): the environment's one profile.
        result = ICoreWebView2Environment_CreateCoreWebView2Controller(
            environment, view->clip, (ICoreWebView2CreateCoreWebView2ControllerCompletedHandler *)done);
    }
    if (FAILED(result)) start_failed(view, result, "WebView2 could not create the view");
    drop_handler(done);
}

static void environment_created(Handler *self, HRESULT status, void *result, void *unused) {
    if (FAILED(status) || !result) {
        environmentState = ENV_FAILED;
        environmentError = FAILED(status) ? status : E_FAIL;
        for (size_t i = 0; i < viewCount; i++) {
            if (views[i]->state == STARTING) start_failed(views[i], environmentError, "WebView2 did not start");
        }
        return;
    }
    environment = result;
    ICoreWebView2Environment_AddRef(environment);
    environmentState = ENV_READY;
    for (size_t i = 0; i < viewCount; i++) {
        if (views[i]->state == STARTING && !views[i]->controller) create_controller(views[i]);
    }
}

// WebView2Loader.dll, beside the program or on the DLL search path, and an installed runtime.
static bool load_loader(void) {
    static bool tried;
    if (createEnvironment) return true;
    if (tried) return false;
    tried = true;
    HMODULE loader = NULL;
    WCHAR path[MAX_PATH + 32];
    DWORD length = GetModuleFileNameW(NULL, path, MAX_PATH);
    if (length > 0 && length < MAX_PATH) {
        WCHAR *slash = wcsrchr(path, L'\\');
        if (slash) {
            wcscpy(slash + 1, L"WebView2Loader.dll");
            loader = LoadLibraryW(path);
        }
    }
    if (!loader) loader = LoadLibraryW(L"WebView2Loader.dll");
    if (!loader) return false;
    CreateEnvironmentFn create =
        (CreateEnvironmentFn)(void (*)(void))GetProcAddress(loader, "CreateCoreWebView2EnvironmentWithOptions");
    VersionFn version =
        (VersionFn)(void (*)(void))GetProcAddress(loader, "GetAvailableCoreWebView2BrowserVersionString");
    if (!create || !version) return false;
    LPWSTR installed = NULL;
    HRESULT result = version(NULL, &installed);
    if (installed) CoTaskMemFree(installed);
    if (FAILED(result) || !installed) return false;
    createEnvironment = create;
    return true;
}

// %LOCALAPPDATA%\<program name>\WebView2, or NULL for WebView2's default beside the program.
static WCHAR *user_data_folder(void) {
    WCHAR base[MAX_PATH];
    DWORD length = GetEnvironmentVariableW(L"LOCALAPPDATA", base, MAX_PATH);
    if (length == 0 || length >= MAX_PATH) return NULL;
    WCHAR program[MAX_PATH];
    DWORD programLength = GetModuleFileNameW(NULL, program, MAX_PATH);
    if (programLength == 0 || programLength >= MAX_PATH) return NULL;
    WCHAR *name = wcsrchr(program, L'\\');
    name = name ? name + 1 : program;
    WCHAR *dot = wcsrchr(name, L'.');
    if (dot) *dot = 0;
    size_t size = wcslen(base) + wcslen(name) + 16;
    WCHAR *folder = malloc(size * sizeof(WCHAR));
    if (!folder) abort();
    swprintf(folder, size, L"%ls\\%ls\\WebView2", base, name);
    return folder;
}

static LRESULT CALLBACK clip_proc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam) {
    if (message == WM_ERASEBKGND) return 1;
    return DefWindowProcW(hwnd, message, wParam, lParam);
}

static void free_view(View *view) {
    for (size_t i = 0; i < view->opCount; i++) free_op(&view->ops[i]);
    free(view->ops);
    free(view->decisions);
    free(view->html);
    free(view->htmlBase);
    free(view->profile);
    free(view);
}

uint32_t silk_webview_open(uint32_t view, uint32_t window, const uint8_t *url, size_t urlLength,
                           const uint8_t *profile, size_t profileLength, uint32_t flags,
                           const uint8_t *script, size_t scriptLength) {
    if (silk_window_backend() != WINDOW_BACKEND_WIN32) return SILK_WEBVIEW_NOT_STARTED;
    if (find_view(view)) return SILK_WEBVIEW_ID_IN_USE;
    void *first = NULL, *second = NULL;
    uint64_t id = 0;
    if (silk_window_raw_surface(window, &first, &second, &id) != WINDOW_SURFACE_WIN32 || !first)
        return SILK_WEBVIEW_NO_WINDOW;
    if (!load_loader()) return SILK_WEBVIEW_NOT_STARTED;
    if (environmentState == ENV_FAILED) return SILK_WEBVIEW_CREATION_FAILED;
    if (!agentScript && script && scriptLength) {
        agentScript = copy_bytes(script, scriptLength);
        agentScriptLength = scriptLength;
    }
    HINSTANCE instance = GetModuleHandleW(NULL);
    if (!clipClass) {
        WNDCLASSEXW wc;
        memset(&wc, 0, sizeof wc);
        wc.cbSize = sizeof wc;
        wc.lpfnWndProc = clip_proc;
        wc.hInstance = instance;
        wc.hCursor = LoadCursorW(NULL, MAKEINTRESOURCEW(32512));
        wc.lpszClassName = L"SilkWebViewClip";
        clipClass = RegisterClassExW(&wc);
        if (!clipClass) return SILK_WEBVIEW_CREATION_FAILED;
    }
    HWND parent = (HWND)first;
    // The window's own drawing leaves its children (the web views) alone.
    SetWindowLongPtrW(parent, GWL_STYLE, GetWindowLongPtrW(parent, GWL_STYLE) | WS_CLIPCHILDREN);
    HWND clip = CreateWindowExW(0, L"SilkWebViewClip", L"", WS_CHILD | WS_CLIPCHILDREN | WS_CLIPSIBLINGS, 0, 0,
                                0, 0, parent, NULL, instance, NULL);
    if (!clip) return SILK_WEBVIEW_CREATION_FAILED;

    View *record = calloc(1, sizeof *record);
    if (!record) abort();
    record->id = view;
    record->serial = nextSerial++;
    record->window = window;
    record->parent = parent;
    record->clip = clip;
    record->state = STARTING;
    record->flags = flags;
    record->nextRequest = 1;
    if (profile && profileLength) record->profile = profile_name((const char *)profile, profileLength);
    if (viewCount == viewCapacity) {
        size_t capacity = viewCapacity ? viewCapacity * 2 : 8;
        View **grown = realloc(views, capacity * sizeof *grown);
        if (!grown) abort();
        views = grown;
        viewCapacity = capacity;
    }
    views[viewCount++] = record;
    if (url && urlLength) {
        Op op = op_of(OP_NAVIGATE);
        op_texts(&op, url, urlLength, NULL, 0);
        submit(record, op);
    }

    if (environmentState == ENV_NONE) {
        environmentState = ENV_CREATING;
        WCHAR *folder = user_data_folder();
        Handler *done = COMPLETED(IID_ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler,
                                  environment_created, 0);
        HRESULT result = createEnvironment(NULL, folder, NULL,
                                           (ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler *)done);
        drop_handler(done);
        free(folder);
        if (FAILED(result)) {
            environmentState = ENV_FAILED;
            environmentError = result;
            viewCount--;
            DestroyWindow(clip);
            free_view(record);
            return SILK_WEBVIEW_CREATION_FAILED;
        }
    } else if (environmentState == ENV_READY) {
        create_controller(record);
    }
    return SILK_WEBVIEW_OPENED;
}

void silk_webview_close(uint32_t id) {
    View *view = find_view(id);
    if (!view) return;
    for (size_t i = 0; i < viewCount; i++) {
        if (views[i] == view) {
            memmove(views + i, views + i + 1, (viewCount - i - 1) * sizeof *views);
            viewCount--;
            break;
        }
    }
    for (size_t i = 0; i < view->decisionCount; i++) free(view->decisions[i].url);
    view->decisionCount = 0;
    if (view->focused && view->parent) SetFocus(view->parent);
    if (view->controller) {
        ICoreWebView2Controller_Close(view->controller);
        if (view->webview) ICoreWebView2_Release(view->webview);
        ICoreWebView2Controller_Release(view->controller);
    }
    DestroyWindow(view->clip);
    free_view(view);
    push(blank(SILK_WEBVIEW_CLOSED, id));
}

uint8_t silk_webview_exists(uint32_t view) { return find_view(view) ? 1 : 0; }

// ---------------------------------------------------------------------------------------
// Placing.

static void apply_placement(View *view) {
    double scale = view_scale(view);
    bool shows = view->placed && view->shows;
    int cx = (int)lround(view->cx0 * scale), cy = (int)lround(view->cy0 * scale);
    int cw = (int)lround(view->cx1 * scale) - cx, ch = (int)lround(view->cy1 * scale) - cy;
    if (!shows) cw = ch = 0;
    SetWindowPos(view->clip, NULL, cx, cy, cw, ch,
                 SWP_NOZORDER | SWP_NOACTIVATE | (shows ? SWP_SHOWWINDOW : SWP_HIDEWINDOW));
    if (!view->controller) return;
    if (shows) {
        // The page's bounds, relative to the clip window.
        RECT bounds;
        bounds.left = (LONG)lround(view->x0 * scale) - cx;
        bounds.top = (LONG)lround(view->y0 * scale) - cy;
        bounds.right = (LONG)lround(view->x1 * scale) - cx;
        bounds.bottom = (LONG)lround(view->y1 * scale) - cy;
        ICoreWebView2Controller_put_Bounds(view->controller, bounds);
    }
    ICoreWebView2Controller_put_IsVisible(view->controller, shows ? TRUE : FALSE);
}

void silk_webview_place(uint32_t id, double x0, double y0, double x1, double y1, double clipX0,
                        double clipY0, double clipX1, double clipY1, uint8_t visible) {
    View *view = find_view(id);
    if (!view) return;
    // The visible part of the bounds; the clip only ever shrinks what shows.
    double cx0 = fmax(clipX0, x0), cy0 = fmax(clipY0, y0);
    double cx1 = fmin(clipX1, x1), cy1 = fmin(clipY1, y1);
    bool shows = visible && cx1 > cx0 && cy1 > cy0 && x1 > x0 && y1 > y0;
    if (view->placed && view->shows == shows && view->x0 == x0 && view->y0 == y0 && view->x1 == x1 &&
        view->y1 == y1 && view->cx0 == cx0 && view->cy0 == cy0 && view->cx1 == cx1 && view->cy1 == cy1) {
        return;
    }
    if (!shows && view->focused) {
        // A hidden view takes no input, keys included.
        SetFocus(view->parent);
    }
    view->placed = true;
    view->shows = shows;
    view->x0 = x0;
    view->y0 = y0;
    view->x1 = x1;
    view->y1 = y1;
    view->cx0 = cx0;
    view->cy0 = cy0;
    view->cx1 = cx1;
    view->cy1 = cy1;
    apply_placement(view);
}

// ---------------------------------------------------------------------------------------
// Commands.

void silk_webview_navigate(uint32_t id, const uint8_t *url, size_t length) {
    View *view = find_view(id);
    if (!view) return;
    Op op = op_of(OP_NAVIGATE);
    op_texts(&op, url, length, NULL, 0);
    submit(view, op);
}

void silk_webview_load_html(uint32_t id, const uint8_t *html, size_t htmlLength, const uint8_t *baseUrl,
                            size_t baseUrlLength) {
    View *view = find_view(id);
    if (!view) return;
    Op op = op_of(OP_LOAD_HTML);
    op_texts(&op, html, htmlLength, baseUrl, baseUrlLength);
    submit(view, op);
}

void silk_webview_go(uint32_t id, uint32_t operation) {
    View *view = find_view(id);
    if (!view) return;
    Op op = op_of(OP_GO);
    op.a = operation;
    submit(view, op);
}

void silk_webview_set_zoom(uint32_t id, double factor) {
    View *view = find_view(id);
    if (!view) return;
    Op op = op_of(OP_ZOOM);
    op.x = factor;
    submit(view, op);
}

void silk_webview_focus(uint32_t id) {
    View *view = find_view(id);
    if (view) submit(view, op_of(OP_FOCUS));
}

void silk_webview_evaluate(uint32_t id, uint32_t request, const uint8_t *script, size_t length) {
    View *view = find_view(id);
    if (!view) return;
    Op op = op_of(OP_EVALUATE);
    op.request = request;
    op_texts(&op, script, length, NULL, 0);
    submit(view, op);
}

void silk_webview_agent(uint32_t id, uint32_t request, uint32_t operation, const uint8_t *call,
                        size_t callLength, const uint8_t *text, size_t textLength) {
    View *view = find_view(id);
    if (!view) return;
    Op op = op_of(OP_AGENT);
    op.request = request;
    op.a = operation;
    op_texts(&op, call, callLength, text, textLength);
    submit(view, op);
}

void silk_webview_screenshot(uint32_t id, uint32_t request) {
    View *view = find_view(id);
    if (!view) return;
    Op op = op_of(OP_SCREENSHOT);
    op.request = request;
    submit(view, op);
}

void silk_webview_click(uint32_t id, double x, double y, uint32_t button, uint32_t clickCount,
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

void silk_webview_move_pointer(uint32_t id, double x, double y, uint32_t modifiers) {
    View *view = find_view(id);
    if (!view) return;
    Op op = op_of(OP_MOVE);
    op.x = x;
    op.y = y;
    op.c = modifiers;
    submit(view, op);
}

void silk_webview_scroll(uint32_t id, double x, double y, double deltaX, double deltaY, uint32_t modifiers) {
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

void silk_webview_type_text(uint32_t id, const uint8_t *text, size_t length) {
    View *view = find_view(id);
    if (!view) return;
    Op op = op_of(OP_TYPE);
    op_texts(&op, text, length, NULL, 0);
    submit(view, op);
}

uint8_t silk_webview_press_key(uint32_t id, const uint8_t *key, size_t length, uint32_t modifiers) {
    View *view = find_view(id);
    if (!view) return 1;
    if (!known_key((const char *)key, key ? length : 0)) return 0;
    Op op = op_of(OP_KEY);
    op.c = modifiers;
    op_texts(&op, key, length, NULL, 0);
    submit(view, op);
    return 1;
}

void silk_webview_answer_navigation(uint32_t id, uint32_t request, uint8_t allow) {
    View *view = find_view(id);
    if (!view) return;
    for (size_t i = 0; i < view->decisionCount; i++) {
        Decision decision = view->decisions[i];
        if (decision.request != request) continue;
        memmove(view->decisions + i, view->decisions + i + 1,
                (view->decisionCount - i - 1) * sizeof *view->decisions);
        view->decisionCount--;
        if (allow && view->webview) {
            // Started again, not asked about again. A form's POST body is not sent again.
            WCHAR *url = wide(decision.url);
            view->skipNextAsk = true;
            if (FAILED(ICoreWebView2_Navigate(view->webview, url))) view->skipNextAsk = false;
            free(url);
        }
        free(decision.url);
        return;
    }
}

uint8_t silk_webview_open_devtools(uint32_t id) {
    View *view = find_view(id);
    if (!view) return 1;
    if (!(view->flags & SILK_WEBVIEW_INSPECTABLE)) return 0;
    submit(view, op_of(OP_DEVTOOLS));
    return 1;
}

// ---------------------------------------------------------------------------------------
// Test hooks.

void silk_webview_test_frame(uint32_t id, double *x, double *y, double *width, double *height,
                             uint8_t *visible) {
    *x = *y = *width = *height = 0;
    *visible = 0;
    View *view = find_view(id);
    if (!view) return;
    double scale = view_scale(view);
    RECT clip;
    GetWindowRect(view->clip, &clip);
    MapWindowPoints(NULL, view->parent, (POINT *)&clip, 2);
    RECT bounds = {0, 0, 0, 0};
    BOOL shown = FALSE;
    if (view->controller) {
        ICoreWebView2Controller_get_Bounds(view->controller, &bounds);
        ICoreWebView2Controller_get_IsVisible(view->controller, &shown);
    }
    *x = (clip.left + bounds.left) / scale;
    *y = (clip.top + bounds.top) / scale;
    *width = (bounds.right - bounds.left) / scale;
    *height = (bounds.bottom - bounds.top) / scale;
    *visible = shown && IsWindowVisible(view->clip) ? 1 : 0;
}
