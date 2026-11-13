// Input encoding and a bounded queue of terminal-generated replies. No Silk callbacks escape.
#include <ghostty/vt.h>
#include <stdlib.h>
#include <string.h>

typedef struct {
    GhosttyKeyEncoder encoder;
    GhosttyKeyEvent event;
    uint8_t *replies;
    size_t length, capacity;
    GhosttyResult error;
} SilkGhosttyInput;

static void reply(GhosttyTerminal terminal, void *userdata, const uint8_t *data, size_t length) {
    (void)terminal;
    SilkGhosttyInput *io = userdata;
    if (io->error || !length) return;
    if (length > 1048576 - io->length) { io->error = GHOSTTY_LIMIT_EXCEEDED; return; }
    size_t needed = io->length + length;
    if (needed > io->capacity) {
        size_t capacity = needed > io->capacity * 2 ? needed : io->capacity * 2;
        uint8_t *buffer = realloc(io->replies, capacity);
        if (!buffer) { io->error = GHOSTTY_OUT_OF_MEMORY; return; }
        io->replies = buffer;
        io->capacity = capacity;
    }
    memcpy(io->replies + io->length, data, length);
    io->length = needed;
}

void silk_ghostty_input_free(SilkGhosttyInput *io) {
    if (!io) return;
    ghostty_key_encoder_free(io->encoder);
    ghostty_key_event_free(io->event);
    free(io->replies);
    free(io);
}

int32_t silk_ghostty_input_new(GhosttyTerminal terminal, SilkGhosttyInput **out) {
    *out = NULL;
    SilkGhosttyInput *io = calloc(1, sizeof(*io));
    if (!io) return GHOSTTY_OUT_OF_MEMORY;
    GhosttyResult result = ghostty_key_encoder_new(NULL, &io->encoder);
    if (!result) result = ghostty_key_event_new(NULL, &io->event);
    if (!result) result = ghostty_terminal_set(terminal, GHOSTTY_TERMINAL_OPT_USERDATA, io);
    if (!result) result = ghostty_terminal_set(terminal, GHOSTTY_TERMINAL_OPT_WRITE_PTY, (const void *)reply);
    if (result) { silk_ghostty_input_free(io); return result; }
    *out = io;
    return GHOSTTY_SUCCESS;
}

int32_t silk_ghostty_replies(SilkGhosttyInput *io, uint8_t *output, size_t capacity, size_t *written) {
    *written = 0;
    if (io->error) return io->error;
    size_t count = io->length < capacity ? io->length : capacity;
    if (count) {
        memcpy(output, io->replies, count);
        io->length -= count;
        memmove(io->replies, io->replies + count, io->length);
    }
    *written = count;
    return GHOSTTY_SUCCESS;
}

static GhosttyKey keycode(const uint8_t *name, size_t length) {
#define KEY(text, code) if (length == sizeof(text)-1 && !memcmp(name, text, length)) return GHOSTTY_KEY_##code
    KEY("Enter", ENTER); KEY("Tab", TAB); KEY("Backspace", BACKSPACE);
    KEY("Escape", ESCAPE); KEY("Delete", DELETE); KEY("Insert", INSERT);
    KEY("Home", HOME); KEY("End", END); KEY("PageUp", PAGE_UP); KEY("PageDown", PAGE_DOWN);
    KEY("ArrowUp", ARROW_UP); KEY("ArrowDown", ARROW_DOWN);
    KEY("ArrowLeft", ARROW_LEFT); KEY("ArrowRight", ARROW_RIGHT);
    KEY(" ", SPACE); KEY("[", BRACKET_LEFT); KEY("]", BRACKET_RIGHT);
    KEY("\\", BACKSLASH); KEY("/", SLASH); KEY("-", MINUS); KEY("=", EQUAL);
    KEY("`", BACKQUOTE); KEY(";", SEMICOLON); KEY("'", QUOTE);
    KEY(",", COMMA); KEY(".", PERIOD);
    if (length == 1) {
        uint8_t c = name[0];
        if (c >= 'A' && c <= 'Z') c += 'a' - 'A';
        if (c >= 'a' && c <= 'z') return GHOSTTY_KEY_A + c - 'a';
        if (c >= '0' && c <= '9') return GHOSTTY_KEY_DIGIT_0 + c - '0';
    }
    if (length >= 2 && length <= 3 && name[0] == 'F') {
        unsigned n = 0;
        for (size_t i = 1; i < length; ++i) {
            if (name[i] < '0' || name[i] > '9') return GHOSTTY_KEY_UNIDENTIFIED;
            n = n * 10 + name[i] - '0';
        }
        if (n >= 1 && n <= 25) return GHOSTTY_KEY_F1 + n - 1;
    }
    return GHOSTTY_KEY_UNIDENTIFIED;
#undef KEY
}

int32_t silk_ghostty_key(GhosttyTerminal terminal, SilkGhosttyInput *io,
        const uint8_t *name, size_t length, uint32_t mods,
        uint8_t *output, size_t capacity, size_t *written) {
    GhosttyResult result = ghostty_key_encoder_set_from_terminal(io->encoder, terminal);
    if (result) return result;
    GhosttyKey key = keycode(name, length);
    bool text = length == 1 || key == GHOSTTY_KEY_UNIDENTIFIED;
    ghostty_key_event_set_action(io->event, GHOSTTY_KEY_ACTION_PRESS);
    ghostty_key_event_set_key(io->event, key);
    ghostty_key_event_set_mods(io->event, mods & 31);
    ghostty_key_event_set_consumed_mods(io->event, 0);
    ghostty_key_event_set_unshifted_codepoint(io->event,
        length == 1 ? (name[0] >= 'A' && name[0] <= 'Z' ? name[0] + 32 : name[0]) : 0);
    ghostty_key_event_set_utf8(io->event, text ? (GhosttyString){.ptr=name,.len=length} : (GhosttyString){0});
    result = ghostty_key_encoder_encode(io->encoder, io->event, output, capacity, written);
    // The event borrows the caller's text only for this call.
    ghostty_key_event_set_utf8(io->event, (GhosttyString){0});
    return result;
}

int32_t silk_ghostty_paste(GhosttyTerminal terminal, const uint8_t *text, size_t length,
        uint8_t *output, size_t capacity, size_t *written) {
    GhosttyTerminalModeConfig mode = {.mode = GHOSTTY_MODE_BRACKETED_PASTE};
    GhosttyResult result = ghostty_terminal_get(terminal, GHOSTTY_TERMINAL_DATA_MODE, &mode);
    if (result) return result;
    char *copy = length ? malloc(length) : NULL;
    if (length && !copy) return GHOSTTY_OUT_OF_MEMORY;
    if (length) memcpy(copy, text, length);
    result = ghostty_paste_encode(copy, length, mode.value, output, capacity, written);
    free(copy);
    return result;
}
