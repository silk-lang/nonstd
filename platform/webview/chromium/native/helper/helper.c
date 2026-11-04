// CEF's executable for its other processes (renderer, GPU, utility), named by the browser
// process's browser_subprocess_path. scripts/install-cef builds it into the runtime directory,
// beside CEF's library (libcef.so, libcef.dll, or the Chromium Embedded Framework on macOS),
// which it loads from its own directory.
#if defined(_WIN32)
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#else
#define _GNU_SOURCE
#include <dlfcn.h>
#include <limits.h>
#include <unistd.h>
#endif
#if defined(__APPLE__)
#include <mach-o/dyld.h>
#endif
#include <stdio.h>
#include <string.h>

#include "include/cef_api_hash.h"
#include "include/capi/cef_app_capi.h"

#if defined(_WIN32)
static const char libraryName[] = "libcef.dll";
#elif defined(__APPLE__)
static const char libraryName[] =
    "Chromium Embedded Framework.framework/Chromium Embedded Framework";
#else
static const char libraryName[] = "libcef.so";
#endif

// The path of this executable's directory, with a separator at the end; false when unknown.
static int own_directory(char *path, size_t size) {
#if defined(_WIN32)
    DWORD length = GetModuleFileNameA(NULL, path, (DWORD)size);
    if (length == 0 || length >= size) return 0;
    char *slash = strrchr(path, '\\');
#elif defined(__APPLE__)
    uint32_t length = (uint32_t)size;
    if (_NSGetExecutablePath(path, &length) != 0) return 0;
    char *slash = strrchr(path, '/');
#else
    ssize_t length = readlink("/proc/self/exe", path, size - 1);
    if (length <= 0) return 0;
    path[length] = 0;
    char *slash = strrchr(path, '/');
#endif
    if (!slash) return 0;
    slash[1] = 0;
    return 1;
}

#if defined(_WIN32)
typedef HMODULE Library;
static Library load(const char *path) { return LoadLibraryExA(path, NULL, LOAD_WITH_ALTERED_SEARCH_PATH); }
static void *symbol(Library library, const char *name) { return (void *)GetProcAddress(library, name); }
#else
typedef void *Library;
static Library load(const char *path) { return dlopen(path, RTLD_NOW | RTLD_LOCAL); }
static void *symbol(Library library, const char *name) { return dlsym(library, name); }
#endif

int main(int argc, char **argv) {
    char path[4096];
    if (!own_directory(path, sizeof path - sizeof libraryName)) return 1;
    strcat(path, libraryName);
    Library library = load(path);
    if (!library) {
        fprintf(stderr, "silk-cef-helper: %s did not load\n", path);
        return 1;
    }
    __typeof__(cef_api_hash) *apiHash = (__typeof__(cef_api_hash) *)symbol(library, "cef_api_hash");
    __typeof__(cef_execute_process) *execute =
        (__typeof__(cef_execute_process) *)symbol(library, "cef_execute_process");
    if (!apiHash || !execute) return 1;
    // The same API version as the browser process's bridge.
    apiHash(CEF_API_VERSION, 0);
#if defined(_WIN32)
    (void)argc;
    (void)argv;
    cef_main_args_t args = {GetModuleHandleW(NULL)};
#else
    cef_main_args_t args = {argc, argv};
#endif
    return execute(&args, NULL, NULL);
}
