// What the package compiles: the CEF bridge when scripts/install-cef put CEF's headers in
// native/cef/include, and otherwise a stand-in whose silk_cef_start says to install them.
#if __has_include("include/cef_api_hash.h")
#include "bridge.c"
#else
#include "stub.c"
#endif
