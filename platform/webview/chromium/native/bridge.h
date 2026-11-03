// The C ABI between platform-webview-chromium's Silk code (src/sys.silk) and the CEF bridge
// (bridge.c). Every function runs on the thread that called silk_cef_start (the app's main
// thread), which is also where CEF's browser process UI thread runs: CEF uses an external message
// pump, worked by silk_cef_pump. Strings are UTF-8 with a length and no terminator. Nothing here
// calls back into Silk: events queue here, and each one wakes platform-window's nextEvent.
#pragma once
#include <stddef.h>
#include <stdint.h>

// Event kinds: the same numbers as platform/webview's native bridge, decoded the same way.
enum {
    SILK_CEF_CREATED = 1,
    SILK_CEF_CLOSED = 2,
    SILK_CEF_LOAD_STARTED = 3,          // text 0 url
    SILK_CEF_LOAD_PROGRESS = 4,         // value
    SILK_CEF_LOAD_FINISHED = 5,         // text 0 url, text 1 error, OK flag
    SILK_CEF_URL_CHANGED = 6,           // text 0 url
    SILK_CEF_TITLE_CHANGED = 7,         // text 0 title
    SILK_CEF_HISTORY_CHANGED = 8,       // OK flag: can go back, SECOND flag: forward
    SILK_CEF_NAVIGATION_REQUESTED = 9,  // request, text 0 url, OK flag: user initiated
    SILK_CEF_NEW_WINDOW_REQUESTED = 10, // text 0 url
    SILK_CEF_FOCUS_CHANGED = 11,        // OK flag: focused
    SILK_CEF_SCRIPT_RESULT = 12,        // request, text 0 JSON or error, OK flag
    SILK_CEF_SNAPSHOT = 13,             // request, text 0 outline
    SILK_CEF_SCREENSHOT = 14,           // request, text 0 PNG bytes (empty when it failed)
    SILK_CEF_ACTION_RESULT = 15,        // request, text 0 error, OK flag
    SILK_CEF_CONSOLE = 16,              // level, text 0 message
    SILK_CEF_UNSUPPORTED = 17,          // request, text 0 command name
    SILK_CEF_CRASHED = 18,              // text 0 reason
};

enum {
    SILK_CEF_FLAG_OK = 1,
    SILK_CEF_FLAG_SECOND = 2,
};

// Options of silk_cef_start.
enum {
    // Run without Chromium's sandbox (containers and CI without user namespaces).
    SILK_CEF_NO_SANDBOX = 1,
    // Frames arrive as dma-bufs (OnAcceleratedPaint) instead of CPU pixels (OnPaint).
    SILK_CEF_SHARED_TEXTURES = 2,
    // No GPU process work: software compositing (CI, machines without a usable GPU).
    SILK_CEF_DISABLE_GPU = 4,
};

// Results of silk_cef_start.
enum {
    SILK_CEF_STARTED = 0,
    SILK_CEF_NO_LIBRARY = 1,    // libcef.so did not load from the runtime directory
    SILK_CEF_WRONG_VERSION = 2, // its API version is not the one the bridge was built for
    SILK_CEF_INIT_FAILED = 3,   // cef_initialize refused
    SILK_CEF_ALREADY = 4,       // started before (CEF starts once per process)
};

// Options of silk_cef_open.
enum {
    SILK_CEF_INSPECTABLE = 1,
    SILK_CEF_ASK_BEFORE_NAVIGATING = 2,
    SILK_CEF_TRANSPARENT = 4,
};

// Results of silk_cef_open.
enum {
    SILK_CEF_OPENED = 0,
    SILK_CEF_ID_IN_USE = 2,
    SILK_CEF_NOT_STARTED = 3,
    SILK_CEF_CREATION_FAILED = 4,
};

// Agent operations of silk_cef_agent.
enum {
    SILK_CEF_AGENT_SNAPSHOT = 0,
    SILK_CEF_AGENT_CLICK = 1,
    SILK_CEF_AGENT_FILL = 2,
};

// History and loading operations of silk_cef_go.
enum {
    SILK_CEF_BACK = 0,
    SILK_CEF_FORWARD = 1,
    SILK_CEF_RELOAD = 2,
    SILK_CEF_STOP = 3,
};

// Kinds of silk_cef_key.
enum {
    SILK_CEF_KEY_DOWN = 0, // a raw key down: no text
    SILK_CEF_KEY_UP = 1,
    SILK_CEF_KEY_CHAR = 2, // the text a key typed, one UTF-16 unit
};

// Kinds of a frame (SilkCefFrame.kind).
enum {
    SILK_CEF_FRAME_NONE = 0,
    SILK_CEF_FRAME_PIXELS = 1, // `pixels`: BGRA, premultiplied, rows top first, width * 4 apart
    SILK_CEF_FRAME_DMABUF = 2, // `planes`: a dma-buf the bridge owns until the next frame
};

typedef struct SilkCefEvent {
    uint32_t kind;
    uint32_t view;
    uint32_t request;
    uint32_t flags;
    uint32_t level; // ConsoleLevel discriminant
    uint32_t width;
    uint32_t height;
    uint32_t count; // number of strings
    double value;
} SilkCefEvent;

typedef struct SilkCefPlane {
    int32_t fd;
    uint32_t stride;
    uint64_t offset;
} SilkCefPlane;

// The latest frame of a view or of its popup (a <select>'s list), in device pixels.
typedef struct SilkCefFrame {
    uint32_t kind;
    uint32_t width;
    uint32_t height;
    // Bumped by every new frame, so the app uploads only what changed.
    uint64_t generation;
    const uint8_t *pixels;
    // DRM fourcc format and modifier, and the planes, of a dma-buf frame.
    uint32_t drmFormat;
    uint32_t planeCount;
    uint64_t drmModifier;
    SilkCefPlane planes[4];
    // A popup's place in the view, in device pixels; whether it shows.
    int32_t x;
    int32_t y;
    uint32_t shown;
} SilkCefFrame;

// Loads libcef.so from `runtimeDir` (with its resources and locales), and starts CEF with
// `helperPath` as the executable of its other processes. `cacheRoot` holds persistent profiles;
// empty keeps everything in memory. `switches` is extra Chromium command line switches, one per
// line, without the leading dashes ("ozone-platform=x11").
uint32_t silk_cef_start(const uint8_t *runtimeDir, size_t runtimeDirLength,
                        const uint8_t *helperPath, size_t helperPathLength,
                        const uint8_t *cacheRoot, size_t cacheRootLength,
                        const uint8_t *switches, size_t switchesLength, uint32_t flags,
                        const uint8_t *agentScript, size_t agentScriptLength);
// Runs CEF's work that is due. Returns 1 while CEF runs.
uint8_t silk_cef_pump(void);
// Seconds until CEF next wants silk_cef_pump, for a loop that waits on its own.
double silk_cef_next_pump(void);
// Closes every view, pumps until they are gone, and shuts CEF down. CEF cannot start again in
// this process.
void silk_cef_shutdown(void);
// A message saying why the last silk_cef_start failed, NUL-terminated.
const char *silk_cef_error(void);

uint32_t silk_cef_open(uint32_t view, const uint8_t *url, size_t urlLength,
                       const uint8_t *profile, size_t profileLength, uint32_t flags);
void silk_cef_close(uint32_t view);
uint8_t silk_cef_exists(uint32_t view);
// Bounds and clip in points from the top left of the window's content area; `scale` is device
// pixels per point.
void silk_cef_place(uint32_t view, double x0, double y0, double x1, double y1, double clipX0,
                    double clipY0, double clipX1, double clipY1, uint8_t visible, double scale);

// Returns 1 and fills `event` with the oldest queued event, 0 when none is queued.
uint8_t silk_cef_next_event(SilkCefEvent *event);
// The `index`th string of the event last returned, valid until the next call to
// silk_cef_next_event. NULL past the last one.
const uint8_t *silk_cef_event_text(size_t index, size_t *length);
// Queues an event Silk made itself (an Unsupported, a refused ref), in order with the rest.
void silk_cef_queue(uint32_t view, uint32_t kind, uint32_t request, uint32_t flags,
                    const uint8_t *text, size_t length);

void silk_cef_navigate(uint32_t view, const uint8_t *url, size_t length);
void silk_cef_load_html(uint32_t view, const uint8_t *html, size_t htmlLength,
                        const uint8_t *baseUrl, size_t baseUrlLength);
void silk_cef_go(uint32_t view, uint32_t operation);
void silk_cef_set_zoom(uint32_t view, double factor);
void silk_cef_focus(uint32_t view, uint8_t focused);
void silk_cef_evaluate(uint32_t view, uint32_t request, const uint8_t *script, size_t length);
// Evaluates `call` (built by agent.silk) in the agent's isolated world, then: SNAPSHOT answers
// with its outline; CLICK clicks the located point; FILL types `text` into the focused element.
void silk_cef_agent(uint32_t view, uint32_t request, uint32_t operation, const uint8_t *call,
                    size_t callLength, const uint8_t *text, size_t textLength);
void silk_cef_screenshot(uint32_t view, uint32_t request);
// Agent input, through the DevTools protocol. Positions in CSS pixels of the page's viewport.
// button: 0 primary, 1 auxiliary, 2 secondary. Modifiers are platform/webview's MOD_* bits.
void silk_cef_click(uint32_t view, double x, double y, uint32_t button, uint32_t clickCount,
                    uint32_t modifiers);
void silk_cef_move_pointer(uint32_t view, double x, double y, uint32_t modifiers);
void silk_cef_scroll(uint32_t view, double x, double y, double deltaX, double deltaY,
                     uint32_t modifiers);
void silk_cef_type_text(uint32_t view, const uint8_t *text, size_t length);
// Returns 0 when `key` names no key this backend knows.
uint8_t silk_cef_press_key(uint32_t view, const uint8_t *key, size_t length, uint32_t modifiers);
void silk_cef_answer_navigation(uint32_t view, uint32_t request, uint8_t allow);
// Opens DevTools in a window of its own. Returns 0 when the view is not inspectable.
uint8_t silk_cef_open_devtools(uint32_t view);

// A person's input, forwarded from the window. Positions in CSS pixels of the view's viewport.
// Modifiers are platform/webview's MOD_* bits plus SILK_CEF_MOD_* below.
enum {
    SILK_CEF_MOD_CAPS_LOCK = 16,
    SILK_CEF_MOD_LEFT_BUTTON = 32,
    SILK_CEF_MOD_MIDDLE_BUTTON = 64,
    SILK_CEF_MOD_RIGHT_BUTTON = 128,
    SILK_CEF_MOD_KEYPAD = 256,
};
void silk_cef_mouse_move(uint32_t view, double x, double y, uint32_t modifiers, uint8_t leave);
void silk_cef_mouse_button(uint32_t view, double x, double y, uint32_t button, uint8_t up,
                           uint32_t clickCount, uint32_t modifiers);
void silk_cef_mouse_wheel(uint32_t view, double x, double y, double deltaX, double deltaY,
                          uint32_t modifiers);
// `code` is platform-window's KeyCode discriminant; `character` a UTF-16 unit for KEY_CHAR.
void silk_cef_key(uint32_t view, uint32_t kind, uint32_t code, uint32_t character,
                  uint32_t modifiers);
// Input method composition: preedit text with its selection (UTF-8 byte offsets), committed
// text, or a canceled composition.
void silk_cef_ime_set(uint32_t view, const uint8_t *text, size_t length, size_t selectionStart,
                      size_t selectionEnd);
void silk_cef_ime_commit(uint32_t view, const uint8_t *text, size_t length);
void silk_cef_ime_cancel(uint32_t view);
// The cursor the page wants over the view: platform-window's Cursor discriminant.
uint32_t silk_cef_cursor(uint32_t view);
// Where the page's caret (or composition) is, in CSS pixels of the view, for the input method's
// candidate window. Returns 0 when no editable field has focus.
uint8_t silk_cef_caret(uint32_t view, double *x, double *y, double *width, double *height);

// The view's latest frame (popup 0) or its popup's (popup 1). Returns 0 when there is none.
uint8_t silk_cef_frame(uint32_t view, uint8_t popup, SilkCefFrame *frame);
