.PHONY: build test fmt lint optimize clean all

build:
	cargo build --target wasm32-unknown-unknown --release

test:
	cargo test --features testutils

fmt:
	cargo fmt --all

lint:
	cargo clippy -- -D warnings

optimize:
	stellar contract optimize \
		--wasm target/wasm32-unknown-unknown/release/lending.wasm

clean:
	cargo clean

all: fmt lint build test
