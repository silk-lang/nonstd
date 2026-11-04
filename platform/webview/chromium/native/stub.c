// The CEF bridge's C ABI without CEF: what entry.c builds when CEF's headers were not installed
// (scripts/install-cef puts them in native/cef/include). silk_cef_start says how to get the real
// bridge, and nothing else does anything, so a program that depends on this package but never
// opens a Chromium view (one that uses the system web view on macOS or Windows) builds without
// downloading CEF.
#include "bridge.h"

uint32_t silk_cef_start(const uint8_t *runtimeDir, size_t runtimeDirLength,
                        const uint8_t *helperPath, size_t helperPathLength,
                        const uint8_t *cacheRoot, size_t cacheRootLength,
                        const uint8_t *switches, size_t switchesLength, uint32_t flags,
                        const uint8_t *agentScript, size_t agentScriptLength) {
    return SILK_CEF_NO_LIBRARY;
}
uint8_t silk_cef_pump(void) { return 0; }
double silk_cef_next_pump(void) { return __builtin_inf(); }
void silk_cef_shutdown(void) {}
const char *silk_cef_error(void) {
    return "this program was built without CEF's headers: run scripts/install-cef, then rebuild";
}
uint32_t silk_cef_open(uint32_t view, const uint8_t *url, size_t urlLength,
                       const uint8_t *profile, size_t profileLength, uint32_t flags) {
    return 0;
}
void silk_cef_close(uint32_t view) {}
uint8_t silk_cef_exists(uint32_t view) { return 0; }
void silk_cef_place(uint32_t view, double x0, double y0, double x1, double y1, double clipX0,
                    double clipY0, double clipX1, double clipY1, uint8_t visible, double scale) {}
uint8_t silk_cef_next_event(SilkCefEvent *event) { return 0; }
const uint8_t *silk_cef_event_text(size_t index, size_t *length) {
    if (length) *length = 0;
    return NULL;
}
void silk_cef_queue(uint32_t view, uint32_t kind, uint32_t request, uint32_t flags,
                    const uint8_t *text, size_t length) {}
void silk_cef_navigate(uint32_t view, const uint8_t *url, size_t length) {}
void silk_cef_load_html(uint32_t view, const uint8_t *html, size_t htmlLength,
                        const uint8_t *baseUrl, size_t baseUrlLength) {}
void silk_cef_go(uint32_t view, uint32_t operation) {}
void silk_cef_set_zoom(uint32_t view, double factor) {}
void silk_cef_focus(uint32_t view, uint8_t focused) {}
void silk_cef_evaluate(uint32_t view, uint32_t request, const uint8_t *script, size_t length) {}
void silk_cef_agent(uint32_t view, uint32_t request, uint32_t operation, const uint8_t *call,
                    size_t callLength, const uint8_t *text, size_t textLength) {}
void silk_cef_screenshot(uint32_t view, uint32_t request) {}
void silk_cef_click(uint32_t view, double x, double y, uint32_t button, uint32_t clickCount,
                    uint32_t modifiers) {}
void silk_cef_move_pointer(uint32_t view, double x, double y, uint32_t modifiers) {}
void silk_cef_scroll(uint32_t view, double x, double y, double deltaX, double deltaY,
                     uint32_t modifiers) {}
void silk_cef_type_text(uint32_t view, const uint8_t *text, size_t length) {}
uint8_t silk_cef_press_key(uint32_t view, const uint8_t *key, size_t length, uint32_t modifiers) {
    return 0;
}
void silk_cef_answer_navigation(uint32_t view, uint32_t request, uint8_t allow) {}
uint8_t silk_cef_open_devtools(uint32_t view) { return 0; }
void silk_cef_mouse_move(uint32_t view, double x, double y, uint32_t modifiers, uint8_t leave) {}
void silk_cef_mouse_button(uint32_t view, double x, double y, uint32_t button, uint8_t up,
                           uint32_t clickCount, uint32_t modifiers) {}
void silk_cef_mouse_wheel(uint32_t view, double x, double y, double deltaX, double deltaY,
                          uint32_t modifiers) {}
void silk_cef_key(uint32_t view, uint32_t kind, uint32_t code, uint32_t character,
                  uint32_t modifiers) {}
void silk_cef_ime_set(uint32_t view, const uint8_t *text, size_t length, size_t selectionStart,
                      size_t selectionEnd) {}
void silk_cef_ime_commit(uint32_t view, const uint8_t *text, size_t length) {}
void silk_cef_ime_cancel(uint32_t view) {}
uint32_t silk_cef_cursor(uint32_t view) { return 0; }
uint8_t silk_cef_caret(uint32_t view, double *x, double *y, double *width, double *height) {
    return 0;
}
uint8_t silk_cef_frame(uint32_t view, uint8_t popup, SilkCefFrame *frame) { return 0; }
