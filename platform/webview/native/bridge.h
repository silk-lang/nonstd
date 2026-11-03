// The C ABI between platform/webview's Silk code (src/bridge.silk) and the native web view
// backends: WKWebView on macOS (macos/bridge.m) and WebView2 on Windows (windows/bridge.c).
// Every function must be called on the thread platform-window runs on (the main thread), after
// its platform has started. Strings are UTF-8 with a length and no terminator. Nothing here
// calls back into Silk: events queue here, and each one wakes platform-window's nextEvent.
#pragma once
#include <stddef.h>
#include <stdint.h>

// Event kinds; src/bridge.silk decodes the same numbers into webview.EventKind.
enum {
    SILK_WEBVIEW_CREATED = 1,
    SILK_WEBVIEW_CLOSED = 2,
    SILK_WEBVIEW_LOAD_STARTED = 3,          // text 0 url
    SILK_WEBVIEW_LOAD_PROGRESS = 4,         // value
    SILK_WEBVIEW_LOAD_FINISHED = 5,         // text 0 url, text 1 error, OK flag
    SILK_WEBVIEW_URL_CHANGED = 6,           // text 0 url
    SILK_WEBVIEW_TITLE_CHANGED = 7,         // text 0 title
    SILK_WEBVIEW_HISTORY_CHANGED = 8,       // OK flag: can go back, SECOND flag: forward
    SILK_WEBVIEW_NAVIGATION_REQUESTED = 9,  // request, text 0 url, OK flag: user initiated
    SILK_WEBVIEW_NEW_WINDOW_REQUESTED = 10, // text 0 url
    SILK_WEBVIEW_FOCUS_CHANGED = 11,        // OK flag: focused
    SILK_WEBVIEW_SCRIPT_RESULT = 12,        // request, text 0 JSON or error, OK flag
    SILK_WEBVIEW_SNAPSHOT = 13,             // request, text 0 outline
    SILK_WEBVIEW_SCREENSHOT = 14,           // request, width, height, text 0 RGBA pixels
    SILK_WEBVIEW_ACTION_RESULT = 15,        // request, text 0 error, OK flag
    SILK_WEBVIEW_CONSOLE = 16,              // level, text 0 message
    SILK_WEBVIEW_UNSUPPORTED = 17,          // request, text 0 command name
    SILK_WEBVIEW_CRASHED = 18,              // text 0 reason
};

enum {
    SILK_WEBVIEW_FLAG_OK = 1,
    SILK_WEBVIEW_FLAG_SECOND = 2,
};

// Options of silk_webview_open.
enum {
    SILK_WEBVIEW_INSPECTABLE = 1,
    SILK_WEBVIEW_ASK_BEFORE_NAVIGATING = 2,
    SILK_WEBVIEW_TRANSPARENT = 4,
};

// Results of silk_webview_open.
enum {
    SILK_WEBVIEW_OPENED = 0,
    SILK_WEBVIEW_NO_WINDOW = 1,
    SILK_WEBVIEW_ID_IN_USE = 2,
    SILK_WEBVIEW_NOT_STARTED = 3,
    SILK_WEBVIEW_CREATION_FAILED = 4,
};

// Agent operations of silk_webview_agent.
enum {
    SILK_WEBVIEW_AGENT_SNAPSHOT = 0,
    SILK_WEBVIEW_AGENT_CLICK = 1,
    SILK_WEBVIEW_AGENT_FILL = 2,
};

// History and loading operations of silk_webview_go.
enum {
    SILK_WEBVIEW_BACK = 0,
    SILK_WEBVIEW_FORWARD = 1,
    SILK_WEBVIEW_RELOAD = 2,
    SILK_WEBVIEW_STOP = 3,
};

typedef struct SilkWebViewEvent {
    uint32_t kind;
    uint32_t view;
    uint32_t request;
    uint32_t flags;
    uint32_t level; // ConsoleLevel discriminant
    uint32_t width;
    uint32_t height;
    uint32_t count; // number of strings
    double value;
} SilkWebViewEvent;

// Makes view `view` in platform-window's window `window`, hidden until placed, and queues
// Created once the engine is ready (at once on macOS; WebView2 starts asynchronously, and
// commands sent before then run after it, in order). `agentScript` is injected into every page
// at document start, in a script world of its own.
uint32_t silk_webview_open(uint32_t view, uint32_t window, const uint8_t *url, size_t urlLength,
                           const uint8_t *profile, size_t profileLength, uint32_t flags,
                           const uint8_t *agentScript, size_t agentScriptLength);
void silk_webview_close(uint32_t view);
uint8_t silk_webview_exists(uint32_t view);
// Bounds and clip in points from the top left of the window's content area.
void silk_webview_place(uint32_t view, double x0, double y0, double x1, double y1, double clipX0,
                        double clipY0, double clipX1, double clipY1, uint8_t visible);

// Returns 1 and fills `event` with the oldest queued event, 0 when none is queued.
uint8_t silk_webview_next_event(SilkWebViewEvent *event);
// The `index`th string of the event last returned, valid until the next call to
// silk_webview_next_event. NULL past the last one.
const uint8_t *silk_webview_event_text(size_t index, size_t *length);
// Queues an event Silk made itself (an Unsupported, a refused ref), in order with the rest.
void silk_webview_queue(uint32_t view, uint32_t kind, uint32_t request, uint32_t flags,
                        const uint8_t *text, size_t length);

void silk_webview_navigate(uint32_t view, const uint8_t *url, size_t length);
void silk_webview_load_html(uint32_t view, const uint8_t *html, size_t htmlLength,
                            const uint8_t *baseUrl, size_t baseUrlLength);
void silk_webview_go(uint32_t view, uint32_t operation);
void silk_webview_set_zoom(uint32_t view, double factor);
void silk_webview_focus(uint32_t view);
void silk_webview_evaluate(uint32_t view, uint32_t request, const uint8_t *script, size_t length);
// Evaluates `call` (built by agent.silk) in the agent's content world, then: SNAPSHOT answers
// with its outline; CLICK clicks the located point; FILL types `text` into the focused element.
void silk_webview_agent(uint32_t view, uint32_t request, uint32_t operation, const uint8_t *call,
                        size_t callLength, const uint8_t *text, size_t textLength);
void silk_webview_screenshot(uint32_t view, uint32_t request);
// Positions in CSS pixels of the page's viewport. button: 0 primary, 1 auxiliary, 2 secondary.
void silk_webview_click(uint32_t view, double x, double y, uint32_t button, uint32_t clickCount,
                        uint32_t modifiers);
void silk_webview_move_pointer(uint32_t view, double x, double y, uint32_t modifiers);
void silk_webview_scroll(uint32_t view, double x, double y, double deltaX, double deltaY,
                         uint32_t modifiers);
void silk_webview_type_text(uint32_t view, const uint8_t *text, size_t length);
// Returns 0 when `key` names no key this backend knows.
uint8_t silk_webview_press_key(uint32_t view, const uint8_t *key, size_t length,
                               uint32_t modifiers);
void silk_webview_answer_navigation(uint32_t view, uint32_t request, uint8_t allow);
// Opens the engine's developer tools; 0 when this backend cannot (WebKit, or not inspectable).
uint8_t silk_webview_open_devtools(uint32_t view);

// Test hooks: where the web view is, in points of the window's content area, and whether it shows.
void silk_webview_test_frame(uint32_t view, double *x, double *y, double *width, double *height,
                             uint8_t *visible);
