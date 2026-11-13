// Lifecycle contract: closing an active session kills and reaps its child, even if it ignores HUP.
#include "pty.c"
#include <assert.h>
#include <stdio.h>

static void close_session(const char *command) {
    SilkPty *p = NULL;
    assert(silk_demo_pty_new(80, 24, (const uint8_t *)command, strlen(command), &p) == 0);
    pid_t pid = p->pid;
    uint8_t buffer[128];
    size_t count = 0;
    for (int i = 0; i < 3000 && !count; ++i) {
        assert(silk_demo_pty_read(p, buffer, sizeof(buffer), &count) == 0);
        if (!count) usleep(1000);
    }
    assert(count > 0);
    silk_demo_pty_free(p);
    assert(waitpid(pid, NULL, WNOHANG) == -1 && errno == ECHILD);
    assert(kill(pid, 0) == -1 && errno == ESRCH);
}

int main(void) {
    close_session("printf ready; exec sleep 30");
    close_session("trap '' HUP; printf ready; while :; do sleep 1; done");
    puts("PTY close/reap: pass");
}
