// CEF's executable for its other processes (renderer, GPU, utility), named by the browser
// process's browser_subprocess_path. scripts/install-cef builds it into the runtime directory,
// beside libcef.so, which it loads from its own directory.
#define _GNU_SOURCE
#include <dlfcn.h>
#include <limits.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

#include "include/cef_api_hash.h"
#include "include/capi/cef_app_capi.h"

int main(int argc, char **argv) {
    char path[PATH_MAX];
    ssize_t length = readlink("/proc/self/exe", path, sizeof path - 16);
    if (length <= 0) return 1;
    path[length] = 0;
    char *slash = strrchr(path, '/');
    if (!slash) return 1;
    strcpy(slash + 1, "libcef.so");
    void *library = dlopen(path, RTLD_NOW | RTLD_LOCAL);
    if (!library) {
        fprintf(stderr, "silk-cef-helper: %s\n", dlerror());
        return 1;
    }
    __typeof__(cef_api_hash) *apiHash = (__typeof__(cef_api_hash) *)dlsym(library, "cef_api_hash");
    __typeof__(cef_execute_process) *execute =
        (__typeof__(cef_execute_process) *)dlsym(library, "cef_execute_process");
    if (!apiHash || !execute) return 1;
    // The same API version as the browser process's bridge.
    apiHash(CEF_API_VERSION, 0);
    cef_main_args_t args = {argc, argv};
    return execute(&args, NULL, NULL);
}
