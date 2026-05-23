TESTDATA_REPO               := o3co/xx.hocon
TESTDATA_REF                := main
EXPECTED_DIR                := tests/lightbend/testdata/expected
UNITS_DIR                   := tests/lightbend/testdata/hocon/units-default
UNQUOTED_STARTS_DIR         := tests/lightbend/testdata/unquoted-starts
UNQUOTED_PARENS_DIR         := tests/lightbend/testdata/hocon/unquoted-parens
DEFERRED_RESOLUTION_DIR     := tests/lightbend/testdata/hocon/deferred-resolution
DEFERRED_RESOLUTION_EXP_DIR := tests/lightbend/testdata/expected/hocon/deferred-resolution
KEY_HYPHEN_DIR              := tests/lightbend/testdata/hocon/key-hyphen-position
PATH_EXPR_WS_DIR            := tests/lightbend/testdata/hocon/path-expr-whitespace

.PHONY: testdata test

testdata:
	@if [ -f .xx-hocon-version ] && [ -d "$(EXPECTED_DIR)" ] && [ -d "$(UNITS_DIR)" ] && [ -d "$(UNQUOTED_STARTS_DIR)" ] && [ -d "$(UNQUOTED_PARENS_DIR)" ] && [ -d "$(DEFERRED_RESOLUTION_DIR)" ] && [ -d "$(KEY_HYPHEN_DIR)" ] && [ -d "$(PATH_EXPR_WS_DIR)" ]; then \
	  remote_sha=$$(curl -sf "https://api.github.com/repos/$(TESTDATA_REPO)/commits/$(TESTDATA_REF)" | grep '"sha"' | head -1 | cut -d'"' -f4) && \
	  local_sha=$$(cat .xx-hocon-version) && \
	  if [ "$$remote_sha" = "$$local_sha" ]; then \
	    echo "Expected JSON up to date ($$local_sha)"; exit 0; \
	  fi; \
	fi; \
	tmpdir="$$(mktemp -d)" && \
	trap 'rm -rf "$$tmpdir"' EXIT INT TERM && \
	mkdir -p "$(EXPECTED_DIR)" && \
	mkdir -p "$(UNITS_DIR)" && \
	mkdir -p "$(UNQUOTED_STARTS_DIR)" && \
	mkdir -p "$(UNQUOTED_PARENS_DIR)" && \
	mkdir -p "$(DEFERRED_RESOLUTION_DIR)" && \
	mkdir -p "$(DEFERRED_RESOLUTION_EXP_DIR)" && \
	mkdir -p "$(KEY_HYPHEN_DIR)" && \
	mkdir -p "$(PATH_EXPR_WS_DIR)" && \
	curl -sfL "https://github.com/$(TESTDATA_REPO)/archive/$(TESTDATA_REF).tar.gz" -o "$$tmpdir/archive.tar.gz" && \
	tar xzf "$$tmpdir/archive.tar.gz" -C "$$tmpdir" --strip-components=1 && \
	cp -R "$$tmpdir/expected/hocon/." "$(EXPECTED_DIR)/" && \
	cp -R "$$tmpdir/testdata/hocon/units-default/." "$(UNITS_DIR)/" && \
	cp -R "$$tmpdir/testdata/hocon/unquoted-starts/." "$(UNQUOTED_STARTS_DIR)/" && \
	cp -R "$$tmpdir/testdata/hocon/unquoted-parens/." "$(UNQUOTED_PARENS_DIR)/" && \
	cp -R "$$tmpdir/testdata/hocon/deferred-resolution/." "$(DEFERRED_RESOLUTION_DIR)/" && \
	cp -R "$$tmpdir/testdata/hocon/key-hyphen-position/." "$(KEY_HYPHEN_DIR)/" && \
	cp -R "$$tmpdir/testdata/hocon/path-expr-whitespace/." "$(PATH_EXPR_WS_DIR)/" && \
	curl -sf "https://api.github.com/repos/$(TESTDATA_REPO)/commits/$(TESTDATA_REF)" | grep '"sha"' | head -1 | cut -d'"' -f4 > .xx-hocon-version && \
	echo "Done. Fetched $$(cat .xx-hocon-version)"

test:
	npx vitest run
