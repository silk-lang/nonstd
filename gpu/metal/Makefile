SILK ?= silk
PYTHON ?= python3
CLANG ?= xcrun clang
SDKROOT := $(shell xcrun --sdk macosx --show-sdk-path)
DEPLOYMENT ?= 14.0
NATIVE_FLAGS := -isysroot $(SDKROOT) -mmacosx-version-min=$(DEPLOYMENT) -fno-objc-arc -fblocks -fPIC -O2 -Wall -Wextra -Wno-deprecated-declarations
NATIVE_SOURCES := $(wildcard native/*.m)
NATIVE_ARCHIVE := native/build/libsilkmetal.a
NATIVE_OBJECTS := $(patsubst native/%.m,native/build/%.o,$(NATIVE_SOURCES))

.PHONY: all native check smoke compute render coverage
all: native
	$(SILK) build
native: $(NATIVE_ARCHIVE)

native/build/%.o: native/%.m native/types.h
	@mkdir -p native/build
	$(CLANG) $(NATIVE_FLAGS) -c $< -o $@

$(NATIVE_ARCHIVE): $(NATIVE_OBJECTS)
	xcrun ar rcs $@ $^

examples/%/native/libsilkmetal.a: $(NATIVE_ARCHIVE)
	@mkdir -p $(@D)
	cp $< $@

check: native
	$(SILK) check
compute: examples/compute/native/libsilkmetal.a
	$(SILK) run --manifest-path examples/compute/silk.toml
render: examples/headless-render/native/libsilkmetal.a
	$(SILK) run --manifest-path examples/headless-render/silk.toml

smoke: compute render

coverage:
	$(PYTHON) tools/coverage.py
