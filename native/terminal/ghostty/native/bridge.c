// Keep Ghostty's tagged unions and sized structs on the C side of the ABI.
// Snapshots copy every cell and grapheme: no page pointers escape into Silk.
#include <ghostty/vt.h>
#include <stdlib.h>
#include <string.h>

typedef struct {
    uint32_t foreground, background, flags, width;
    uint8_t *text;
    size_t length;
} SilkGhosttyCell;

typedef struct {
    uint16_t cols, rows;
    GhosttyRenderStateCursor cursor;
    uint32_t foreground, background;
    SilkGhosttyCell *cells;
} SilkGhosttySnapshot;

static uint32_t rgb(GhosttyColorRgb value) {
    return ((uint32_t)value.r << 16) | ((uint32_t)value.g << 8) | value.b;
}

void silk_ghostty_snapshot_free(SilkGhosttySnapshot *snapshot) {
    if (!snapshot) return;
    if (snapshot->cells) {
        size_t count = (size_t)snapshot->cols * snapshot->rows;
        for (size_t i = 0; i < count; ++i) free(snapshot->cells[i].text);
    }
    free(snapshot->cells);
    free(snapshot);
}

#define TRY(call) do { result = (call); if (result != GHOSTTY_SUCCESS) goto done; } while (0)

int32_t silk_ghostty_snapshot_new(GhosttyTerminal terminal, SilkGhosttySnapshot **out) {
    *out = NULL;
    GhosttyResult result = GHOSTTY_OUT_OF_MEMORY;
    GhosttyRenderState state = NULL;
    GhosttyRenderStateRowIterator rows = NULL;
    GhosttyRenderStateRowCells cells = NULL;
    SilkGhosttySnapshot *snapshot = calloc(1, sizeof(*snapshot));
    if (!snapshot) return result;
    TRY(ghostty_render_state_new(NULL, &state));
    TRY(ghostty_render_state_update(state, terminal));
    TRY(ghostty_render_state_get(state, GHOSTTY_RENDER_STATE_DATA_COLS, &snapshot->cols));
    TRY(ghostty_render_state_get(state, GHOSTTY_RENDER_STATE_DATA_ROWS, &snapshot->rows));
    snapshot->cursor = (GhosttyRenderStateCursor)GHOSTTY_INIT_SIZED(GhosttyRenderStateCursor);
    TRY(ghostty_render_state_get(state, GHOSTTY_RENDER_STATE_DATA_CURSOR, &snapshot->cursor));
    GhosttyRenderStateColors colors = GHOSTTY_INIT_SIZED(GhosttyRenderStateColors);
    TRY(ghostty_render_state_get(state, GHOSTTY_RENDER_STATE_DATA_COLORS, &colors));
    snapshot->foreground = rgb(colors.foreground);
    snapshot->background = rgb(colors.background);
    snapshot->cells = calloc((size_t)snapshot->cols * snapshot->rows, sizeof(*snapshot->cells));
    if (!snapshot->cells) { result = GHOSTTY_OUT_OF_MEMORY; goto done; }
    TRY(ghostty_render_state_row_iterator_new(NULL, &rows));
    TRY(ghostty_render_state_row_cells_new(NULL, &cells));
    TRY(ghostty_render_state_get(state, GHOSTTY_RENDER_STATE_DATA_ROW_ITERATOR, &rows));
    size_t y = 0;
    while (ghostty_render_state_row_iterator_next(rows) && y < snapshot->rows) {
        TRY(ghostty_render_state_row_get(rows, GHOSTTY_RENDER_STATE_ROW_DATA_CELLS, &cells));
        size_t x = 0;
        while (ghostty_render_state_row_cells_next(cells) && x < snapshot->cols) {
            SilkGhosttyCell *cell = &snapshot->cells[y * snapshot->cols + x++];
            GhosttyCell raw;
            GhosttyCellWide wide;
            GhosttyStyle style;
            TRY(ghostty_render_state_row_cells_get(cells, GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_RAW, &raw));
            TRY(ghostty_cell_get(raw, GHOSTTY_CELL_DATA_WIDE, &wide));
            TRY(ghostty_render_state_row_cells_get(cells, GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_STYLE, &style));
            cell->flags = style.flags;
            cell->width = wide == GHOSTTY_CELL_WIDE_WIDE ? 2 : wide == GHOSTTY_CELL_WIDE_NARROW ? 1 : 0;
            GhosttyColorRgb fg = colors.foreground, bg = colors.background;
            result = ghostty_render_state_row_cells_get(cells, GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_FG_COLOR, &fg);
            if (result != GHOSTTY_SUCCESS && result != GHOSTTY_NO_VALUE) goto done;
            result = ghostty_render_state_row_cells_get(cells, GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_BG_COLOR, &bg);
            if (result != GHOSTTY_SUCCESS && result != GHOSTTY_NO_VALUE) goto done;
            cell->foreground = rgb(fg);
            cell->background = rgb(bg);
            GhosttyBuffer buffer = {0};
            result = ghostty_render_state_row_cells_get(cells, GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_GRAPHEMES_UTF8, &buffer);
            if (result == GHOSTTY_OUT_OF_SPACE) {
                cell->text = malloc(buffer.len);
                if (!cell->text) { result = GHOSTTY_OUT_OF_MEMORY; goto done; }
                buffer.ptr = cell->text;
                buffer.cap = buffer.len;
                TRY(ghostty_render_state_row_cells_get(cells, GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_GRAPHEMES_UTF8, &buffer));
            } else if (result != GHOSTTY_SUCCESS) goto done;
            cell->length = buffer.len;
        }
        ++y;
    }
    *out = snapshot;
    snapshot = NULL;
    result = GHOSTTY_SUCCESS;
done:
    ghostty_render_state_row_cells_free(cells);
    ghostty_render_state_row_iterator_free(rows);
    ghostty_render_state_free(state);
    silk_ghostty_snapshot_free(snapshot);
    return result;
}

uint32_t silk_ghostty_snapshot_get(const SilkGhosttySnapshot *s, uint32_t field) {
    switch (field) {
        case 0: return s->cols;
        case 1: return s->rows;
        case 2: return s->cursor.viewport_has_value ? s->cursor.viewport_x : 0;
        case 3: return s->cursor.viewport_has_value ? s->cursor.viewport_y : 0;
        case 4: return s->cursor.viewport_has_value && s->cursor.visible;
        case 5: return s->foreground;
        case 6: return s->background;
        default: return 0;
    }
}

uint32_t silk_ghostty_cell_get(const SilkGhosttySnapshot *s, size_t index, uint32_t field) {
    const SilkGhosttyCell *c = &s->cells[index];
    switch (field) {
        case 0: return c->foreground;
        case 1: return c->background;
        case 2: return c->flags;
        case 3: return c->width;
        default: return 0;
    }
}

const uint8_t *silk_ghostty_cell_text(const SilkGhosttySnapshot *s, size_t index, size_t *length) {
    *length = s->cells[index].length;
    return s->cells[index].text;
}

int32_t silk_ghostty_format(GhosttyTerminal terminal, uint8_t **out, size_t *length) {
    GhosttyFormatter formatter = NULL;
    GhosttyResult result = ghostty_formatter_terminal_new(NULL, &formatter, terminal);
    if (result != GHOSTTY_SUCCESS) return result;
    result = ghostty_formatter_format_alloc(formatter, NULL, out, length);
    ghostty_formatter_free(formatter);
    return result;
}

int32_t silk_ghostty_scroll(GhosttyTerminal terminal, int64_t delta, uint8_t bottom) {
    GhosttyTerminalScrollViewport behavior = {0};
    behavior.tag = bottom ? GHOSTTY_TERMINAL_SCROLL_VIEWPORT_BOTTOM : GHOSTTY_TERMINAL_SCROLL_VIEWPORT_DELTA;
    behavior.value.delta = delta;
    return ghostty_terminal_scroll_viewport(terminal, behavior);
}

uint8_t silk_ghostty_processing_error(GhosttyTerminal terminal) {
    bool error = false;
    ghostty_terminal_get(terminal, GHOSTTY_TERMINAL_DATA_VT_PROCESSING_ERROR, &error);
    return error;
}
