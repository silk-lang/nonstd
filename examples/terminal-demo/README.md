# Native terminal

An interactive shell built with `ui-app`, `ui-app-window` and `terminal-ghostty`.
A nonblocking PTY carries process input and output; Ghostty handles terminal state and input
encoding; Silk draws the styled cells in a native WebGPU window.

From the repository root:

```sh
python3 native/terminal/ghostty/scripts/prepare
silk run --manifest-path examples/terminal-demo/silk.toml
```

The demo starts `$SHELL -i` in the current directory, with the account shell or `/bin/sh` as a
fallback when `$SHELL` is unset or not absolute. It inherits the environment and sets
`TERM=xterm-256color`, `COLORTERM=truecolor` and `TERM_PROGRAM=silk-terminal`.
Your shell's usual interactive startup files apply.

macOS and Linux are supported by the build setup; Linux needs Zig 0.17 for preparation.
The native app, shell and Vim have been exercised on Apple Silicon macOS. Linux has been
type-checked, but its window and PTY paths have not been run here. macOS uses the same Xcode/LLVM
setup as the other native packages; set `DEVELOPER_DIR` to Xcode if the active SDK is stale.

## Use

- Type directly into the terminal. Enter, Tab, arrows, function keys and control keys go to the process.
- Ctrl-C interrupts the foreground job; Ctrl-D supplies EOF according to the shell's terminal mode.
- Cmd-V or Ctrl-Shift-V pastes from the clipboard, respecting bracketed-paste mode.
- Resize the window to resize both the emulator and PTY and notify the foreground process.
- Scroll or use Shift-PageUp / Shift-PageDown to inspect scrollback. Typing returns to live output.
- Exiting the shell leaves the transcript and exit status visible. Closing the window hangs up
  the foreground process group and shell, then reaps the shell, escalating if it ignores SIGHUP.

The dark surface uses a fixed monospace grid, ANSI and true-color styles, Unicode graphemes,
wide cells and a cursor indicator. System fonts supply glyph fallback. Full-screen programs can
use the alternate screen and terminal query replies. Selection/copy, terminal mouse reporting,
images, hyperlinks, blinking decorations and complete keyboard-protocol event reporting are
not implemented. macOS Option input stays with the system input method for composed characters.

`TerminalApp` owns the immutable render snapshot and queues input actions. `TerminalHost` owns
`Session`, polls the PTY every 16 ms while active, and drains at most 128 KiB per tick to keep
input responsive. Partial writes are queued with an 8 MiB bound. Protocol replies flow back to
the child, and output is drained through EOF even when its exit status arrives first.

## Checks

```sh
silk test --manifest-path examples/terminal-demo/silk.toml --root src/tests.silk
silk run --manifest-path examples/terminal-demo/silk.toml -- --check
```

The tests exercise real PTY input/output, window size reporting, final output and exit status,
terminal query replies, foreground Ctrl-C, and text/key/resize events through the UI tree.
`--check` starts a deterministic subprocess, verifies native terminal focus, compares GPU output
against the CPU reference, and exits. It uses bundled fixture fonts for repeatable rendering.
A debug run supports `SILK_UI_INSPECT` through the usual native UI inspector.

The C lifecycle test verifies shutdown and reaping, including a child that ignores SIGHUP:

```sh
mkdir -p examples/terminal-demo/build
cc -std=c11 -Wall -Wextra -Werror examples/terminal-demo/native/pty_tests.c \
  -o examples/terminal-demo/build/pty-tests
examples/terminal-demo/build/pty-tests
```

On Linux, add `-lutil` to that compile command.
