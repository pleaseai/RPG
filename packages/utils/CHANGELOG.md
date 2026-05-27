# Changelog

## [0.1.10](https://github.com/pleaseai/soop/compare/soop-utils-v0.1.9...soop-utils-v0.1.10) (2026-05-27)


### Features

* git-grounded sync — silent-fail helpers, decision tree, sentinel-block hooks ([#307](https://github.com/pleaseai/soop/issues/307)) ([cc4388e](https://github.com/pleaseai/soop/commit/cc4388e5c95f125ab020f3b2e6c1152a729cc5be))
* **utils:** update default LLM models to latest supported IDs ([#305](https://github.com/pleaseai/soop/issues/305)) ([c029a4c](https://github.com/pleaseai/soop/commit/c029a4c2844e45d1e92908a6e97f54256d002b2a))

## [0.1.9](https://github.com/pleaseai/soop/compare/soop-utils-v0.1.8...soop-utils-v0.1.9) (2026-03-20)


### Features

* **utils:** add gemini-cli LLM provider ([#252](https://github.com/pleaseai/soop/issues/252)) ([776b07e](https://github.com/pleaseai/soop/commit/776b07e7d384205c35463892a80e079ee80b8dfe))


### Bug Fixes

* **encoder:** spread Map.entries() to array before calling toSorted ([#251](https://github.com/pleaseai/soop/issues/251)) ([8a49ae5](https://github.com/pleaseai/soop/commit/8a49ae5dc0f21f9e684d509382289557e8347889))

## [0.1.8](https://github.com/pleaseai/soop/compare/soop-utils-v0.1.7...soop-utils-v0.1.8) (2026-03-14)


### Features

* **store:** add BM25 scoring to LocalTextSearchStore ([#233](https://github.com/pleaseai/soop/issues/233)) ([d04445d](https://github.com/pleaseai/soop/commit/d04445dc81f19e12e7086d6fdb0c6ac48a918195))

## [0.1.7](https://github.com/pleaseai/soop/compare/soop-utils-v0.1.6...soop-utils-v0.1.7) (2026-03-12)


### Features

* **namu,ast:** migrate to WASM tree-sitter and extract @pleaseai/soop-ast package ([#185](https://github.com/pleaseai/soop/issues/185)) ([0b29d7a](https://github.com/pleaseai/soop/commit/0b29d7ad39cb80a16bb7bd8766c83c1ec8f00904))

## [0.1.6](https://github.com/pleaseai/soop/compare/soop-utils-v0.1.5...soop-utils-v0.1.6) (2026-03-09)


### Features

* **ast:** add C#, C/C++, Ruby, Kotlin language support and upgrade tree-sitter ([#107](https://github.com/pleaseai/soop/issues/107)) ([4be235a](https://github.com/pleaseai/soop/commit/4be235a9727ba4400573a82bfa6dd124466dbaae))
* **ast:** add multi-language support (Rust, Go, Java) ([#68](https://github.com/pleaseai/soop/issues/68)) ([931b345](https://github.com/pleaseai/soop/commit/931b3454539e8716637fb7faa759c21385bc6121))
* **cli:** add two-tier RPG data management (CI + local) ([#71](https://github.com/pleaseai/soop/issues/71)) ([2b00bdf](https://github.com/pleaseai/soop/commit/2b00bdf2a6489d6f1224ab344f7cd8d649ce2d8a))
* **encoder:** achieve full parity with Python reference encoder ([#105](https://github.com/pleaseai/soop/issues/105)) ([812e16e](https://github.com/pleaseai/soop/commit/812e16ee4661eb3d597635d93f49ac093df25801))
* **encoder:** add git-managed vector embeddings with Float16 codec ([#74](https://github.com/pleaseai/soop/issues/74)) ([d3fdb4d](https://github.com/pleaseai/soop/commit/d3fdb4d0499b1e0aaa17cb94ad1ed6bcc9b4e4c5))
* **encoder:** change default LLM provider to google/gemini-3.1-flash-lite-preview ([#169](https://github.com/pleaseai/soop/issues/169)) ([88e833c](https://github.com/pleaseai/soop/commit/88e833c684b7749a2915a09e5920ba3baf38c1ea))
* **encoder:** support flexible 2-5 level hierarchy and evolution area creation ([#155](https://github.com/pleaseai/soop/issues/155)) ([7e12b26](https://github.com/pleaseai/soop/commit/7e12b268f7cf5357435eddcc443425a08831ee13))
* rebrand from rpg to repo please with monorepo restructure ([#117](https://github.com/pleaseai/soop/issues/117)) ([d4b805a](https://github.com/pleaseai/soop/commit/d4b805abc23f20e8ac3fe1b375c105ba7a6c9b33))
* **store:** add zero-dependency local fallback stores and make native deps optional ([#92](https://github.com/pleaseai/soop/issues/92)) ([edf43fe](https://github.com/pleaseai/soop/commit/edf43fe5e25871723ae1742f795471768560380d))
* **utils:** add claude-code LLM provider ([#66](https://github.com/pleaseai/soop/issues/66)) ([00d8ce2](https://github.com/pleaseai/soop/commit/00d8ce2165c568e41ca0cf890e2d328c450fbe25))
* **utils:** add Codex CLI LLM provider ([#73](https://github.com/pleaseai/soop/issues/73)) ([de76959](https://github.com/pleaseai/soop/commit/de76959321b351eb8b760252cc9804473de0dd89))


### Bug Fixes

* **build:** resolve Bun compile errors for cross-platform binary distribution ([#114](https://github.com/pleaseai/soop/issues/114)) ([1f9ce01](https://github.com/pleaseai/soop/commit/1f9ce01e67825b2019733f6c28cdfe984a4379d6))

## [0.1.5](https://github.com/pleaseai/soop/compare/soop-utils-v0.1.4...soop-utils-v0.1.5) (2026-03-09)


### Features

* **encoder:** change default LLM provider to google/gemini-3.1-flash-lite-preview ([#169](https://github.com/pleaseai/soop/issues/169)) ([88e833c](https://github.com/pleaseai/soop/commit/88e833c684b7749a2915a09e5920ba3baf38c1ea))
* **encoder:** support flexible 2-5 level hierarchy and evolution area creation ([#155](https://github.com/pleaseai/soop/issues/155)) ([7e12b26](https://github.com/pleaseai/soop/commit/7e12b268f7cf5357435eddcc443425a08831ee13))

## [0.1.4](https://github.com/pleaseai/soop/compare/soop-utils-v0.1.3...soop-utils-v0.1.4) (2026-02-25)


### Features

* **ast:** add C#, C/C++, Ruby, Kotlin language support and upgrade tree-sitter ([#107](https://github.com/pleaseai/soop/issues/107)) ([4be235a](https://github.com/pleaseai/soop/commit/4be235a9727ba4400573a82bfa6dd124466dbaae))
* **ast:** add multi-language support (Rust, Go, Java) ([#68](https://github.com/pleaseai/soop/issues/68)) ([931b345](https://github.com/pleaseai/soop/commit/931b3454539e8716637fb7faa759c21385bc6121))
* **cli:** add two-tier RPG data management (CI + local) ([#71](https://github.com/pleaseai/soop/issues/71)) ([2b00bdf](https://github.com/pleaseai/soop/commit/2b00bdf2a6489d6f1224ab344f7cd8d649ce2d8a))
* **encoder:** achieve full parity with Python reference encoder ([#105](https://github.com/pleaseai/soop/issues/105)) ([812e16e](https://github.com/pleaseai/soop/commit/812e16ee4661eb3d597635d93f49ac093df25801))
* **encoder:** add git-managed vector embeddings with Float16 codec ([#74](https://github.com/pleaseai/soop/issues/74)) ([d3fdb4d](https://github.com/pleaseai/soop/commit/d3fdb4d0499b1e0aaa17cb94ad1ed6bcc9b4e4c5))
* rebrand from rpg to repo please with monorepo restructure ([#117](https://github.com/pleaseai/soop/issues/117)) ([d4b805a](https://github.com/pleaseai/soop/commit/d4b805abc23f20e8ac3fe1b375c105ba7a6c9b33))
* **store:** add zero-dependency local fallback stores and make native deps optional ([#92](https://github.com/pleaseai/soop/issues/92)) ([edf43fe](https://github.com/pleaseai/soop/commit/edf43fe5e25871723ae1742f795471768560380d))
* **utils:** add claude-code LLM provider ([#66](https://github.com/pleaseai/soop/issues/66)) ([00d8ce2](https://github.com/pleaseai/soop/commit/00d8ce2165c568e41ca0cf890e2d328c450fbe25))
* **utils:** add Codex CLI LLM provider ([#73](https://github.com/pleaseai/soop/issues/73)) ([de76959](https://github.com/pleaseai/soop/commit/de76959321b351eb8b760252cc9804473de0dd89))


### Bug Fixes

* **build:** resolve Bun compile errors for cross-platform binary distribution ([#114](https://github.com/pleaseai/soop/issues/114)) ([1f9ce01](https://github.com/pleaseai/soop/commit/1f9ce01e67825b2019733f6c28cdfe984a4379d6))
