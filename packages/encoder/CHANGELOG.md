# Changelog

## [0.4.0](https://github.com/pleaseai/soop/compare/soop-encoder-v0.3.3...soop-encoder-v0.4.0) (2026-05-27)


### ⚠ BREAKING CHANGES

* **encoder:** evolve CLI interface changed — requires <repo-path> positional arg, --graph option renamed to -l/--load-path, --stamp flag removed (auto-applied in save()).

### Features

* **ast:** add C#, C/C++, Ruby, Kotlin language support and upgrade tree-sitter ([#107](https://github.com/pleaseai/soop/issues/107)) ([4be235a](https://github.com/pleaseai/soop/commit/4be235a9727ba4400573a82bfa6dd124466dbaae))
* **encoder:** achieve full parity with Python reference encoder ([#105](https://github.com/pleaseai/soop/issues/105)) ([812e16e](https://github.com/pleaseai/soop/commit/812e16ee4661eb3d597635d93f49ac093df25801))
* **encoder:** add dep_graph.json sidecar + HTML visualize stages ([#300](https://github.com/pleaseai/soop/issues/300)) ([f2eb901](https://github.com/pleaseai/soop/commit/f2eb901c1f55034df92b8116b6e736e12ed582ef))
* **encoder:** add git-managed vector embeddings with Float16 codec ([#74](https://github.com/pleaseai/soop/issues/74)) ([d3fdb4d](https://github.com/pleaseai/soop/commit/d3fdb4d0499b1e0aaa17cb94ad1ed6bcc9b4e4c5))
* **encoder:** change default LLM provider to google/gemini-3.1-flash-lite-preview ([#169](https://github.com/pleaseai/soop/issues/169)) ([88e833c](https://github.com/pleaseai/soop/commit/88e833c684b7749a2915a09e5920ba3baf38c1ea))
* **encoder:** implement DependencyGraph with invocation and inheritance tracking ([#83](https://github.com/pleaseai/soop/issues/83)) ([3e21441](https://github.com/pleaseai/soop/commit/3e21441e8f4301886886997381573030eae85603))
* **encoder:** implement token-aware batch semantic extraction ([#82](https://github.com/pleaseai/soop/issues/82)) ([b1f8ad2](https://github.com/pleaseai/soop/commit/b1f8ad25b5d8ccad3940eca2c4014c2ce33e7237))
* **encoder:** implement type-aware call resolution in DependencyGraph ([#90](https://github.com/pleaseai/soop/issues/90)) ([5da75f7](https://github.com/pleaseai/soop/commit/5da75f74a23c91d87aaff29d9d10a066b2ea2bf7))
* **encoder:** improve semantic extraction quality from reference analysis ([#166](https://github.com/pleaseai/soop/issues/166)) ([aa3f980](https://github.com/pleaseai/soop/commit/aa3f980c50d59cdc1c484eefa864a2765a687fe5))
* **encoder:** support flexible 2-5 level hierarchy and evolution area creation ([#155](https://github.com/pleaseai/soop/issues/155)) ([7e12b26](https://github.com/pleaseai/soop/commit/7e12b268f7cf5357435eddcc443425a08831ee13))
* git-grounded sync — silent-fail helpers, decision tree, sentinel-block hooks ([#307](https://github.com/pleaseai/soop/issues/307)) ([cc4388e](https://github.com/pleaseai/soop/commit/cc4388e5c95f125ab020f3b2e6c1152a729cc5be))
* **graph,encoder:** persist DependencyEdge symbols and add cross-boundary excerpts ([#156](https://github.com/pleaseai/soop/issues/156)) ([0fadc4f](https://github.com/pleaseai/soop/commit/0fadc4fe972a1ad91c58f9c769a8054569fb0f6d))
* JSONL graph format for git-friendly storage ([#262](https://github.com/pleaseai/soop/issues/262)) ([467ef23](https://github.com/pleaseai/soop/commit/467ef23ea0574056c07be5058bbc39112aa45a9e))
* **namu,ast:** migrate to WASM tree-sitter and extract @pleaseai/soop-ast package ([#185](https://github.com/pleaseai/soop/issues/185)) ([0b29d7a](https://github.com/pleaseai/soop/commit/0b29d7ad39cb80a16bb7bd8766c83c1ec8f00904))
* rebrand from rpg to repo please with monorepo restructure ([#117](https://github.com/pleaseai/soop/issues/117)) ([d4b805a](https://github.com/pleaseai/soop/commit/d4b805abc23f20e8ac3fe1b375c105ba7a6c9b33))
* **store:** add BM25 scoring to LocalTextSearchStore ([#233](https://github.com/pleaseai/soop/issues/233)) ([d04445d](https://github.com/pleaseai/soop/commit/d04445dc81f19e12e7086d6fdb0c6ac48a918195))
* **store:** add zero-dependency local fallback stores and make native deps optional ([#92](https://github.com/pleaseai/soop/issues/92)) ([edf43fe](https://github.com/pleaseai/soop/commit/edf43fe5e25871723ae1742f795471768560380d))
* **utils:** add claude-code LLM provider ([#66](https://github.com/pleaseai/soop/issues/66)) ([00d8ce2](https://github.com/pleaseai/soop/commit/00d8ce2165c568e41ca0cf890e2d328c450fbe25))
* **utils:** add Codex CLI LLM provider ([#73](https://github.com/pleaseai/soop/issues/73)) ([de76959](https://github.com/pleaseai/soop/commit/de76959321b351eb8b760252cc9804473de0dd89))


### Bug Fixes

* **build:** resolve Bun compile errors for cross-platform binary distribution ([#114](https://github.com/pleaseai/soop/issues/114)) ([1f9ce01](https://github.com/pleaseai/soop/commit/1f9ce01e67825b2019733f6c28cdfe984a4379d6))
* **encoder:** convert BigInt attention_mask from ONNX int64 tensors to number ([#220](https://github.com/pleaseai/soop/issues/220)) ([747c10e](https://github.com/pleaseai/soop/commit/747c10e6537c47ca2ce9c91f4073c939a51f0119))
* **encoder:** resolve dependency rebuild UNIQUE constraint and embedding ID mismatch ([#239](https://github.com/pleaseai/soop/issues/239)) ([b43f9a0](https://github.com/pleaseai/soop/commit/b43f9a011c05050d17c1073e92f089b83a765d95))
* **encoder:** resolve voyage-4-nano ONNX model not found in CI ([#217](https://github.com/pleaseai/soop/issues/217)) ([02b5dcd](https://github.com/pleaseai/soop/commit/02b5dcd0acc13b823b63cbda26bcd2aaf66c2154))
* **encoder:** spread Map before toSorted to avoid iterator error ([#282](https://github.com/pleaseai/soop/issues/282)) ([03b462e](https://github.com/pleaseai/soop/commit/03b462ed82270b28b5e7d39e3cb5b01faeaf6680))
* **encoder:** spread Map.entries() to array before calling toSorted ([#251](https://github.com/pleaseai/soop/issues/251)) ([8a49ae5](https://github.com/pleaseai/soop/commit/8a49ae5dc0f21f9e684d509382289557e8347889))
* **encoder:** use composite keys in batch prompts to prevent name collision ([#168](https://github.com/pleaseai/soop/issues/168)) ([7138c9c](https://github.com/pleaseai/soop/commit/7138c9c9f03728220024475379b5427e01cff1e2))
* **graph:** store meta rootPath relative to graph file for portability ([#295](https://github.com/pleaseai/soop/issues/295)) ([6c52dfd](https://github.com/pleaseai/soop/commit/6c52dfd3f65f2b90c3b5e384a92a2a377adc4122))


### Code Refactoring

* **encoder:** align RPGEncoder API and CLI with reference implementation ([#231](https://github.com/pleaseai/soop/issues/231)) ([9a2a89a](https://github.com/pleaseai/soop/commit/9a2a89a464b265caf951fc54cbe4879d5933d52c))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @pleaseai/soop-graph bumped to 0.1.13
    * @pleaseai/soop-utils bumped to 0.1.10

## [0.3.3](https://github.com/pleaseai/soop/compare/soop-encoder-v0.3.2...soop-encoder-v0.3.3) (2026-04-20)


### Bug Fixes

* **encoder:** spread Map before toSorted to avoid iterator error ([#282](https://github.com/pleaseai/soop/issues/282)) ([03b462e](https://github.com/pleaseai/soop/commit/03b462ed82270b28b5e7d39e3cb5b01faeaf6680))

## [0.3.2](https://github.com/pleaseai/soop/compare/soop-encoder-v0.3.1...soop-encoder-v0.3.2) (2026-04-02)


### Features

* JSONL graph format for git-friendly storage ([#262](https://github.com/pleaseai/soop/issues/262)) ([467ef23](https://github.com/pleaseai/soop/commit/467ef23ea0574056c07be5058bbc39112aa45a9e))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @pleaseai/soop-graph bumped to 0.1.12

## [0.3.1](https://github.com/pleaseai/soop/compare/soop-encoder-v0.3.0...soop-encoder-v0.3.1) (2026-03-20)


### Bug Fixes

* **encoder:** spread Map.entries() to array before calling toSorted ([#251](https://github.com/pleaseai/soop/issues/251)) ([8a49ae5](https://github.com/pleaseai/soop/commit/8a49ae5dc0f21f9e684d509382289557e8347889))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @pleaseai/soop-graph bumped to 0.1.11
    * @pleaseai/soop-store bumped to 0.1.9
    * @pleaseai/soop-utils bumped to 0.1.9

## [0.3.0](https://github.com/pleaseai/soop/compare/soop-encoder-v0.2.0...soop-encoder-v0.3.0) (2026-03-16)


### ⚠ BREAKING CHANGES

* **encoder:** evolve CLI interface changed — requires <repo-path> positional arg, --graph option renamed to -l/--load-path, --stamp flag removed (auto-applied in save()).

### Features

* **ast:** add C#, C/C++, Ruby, Kotlin language support and upgrade tree-sitter ([#107](https://github.com/pleaseai/soop/issues/107)) ([4be235a](https://github.com/pleaseai/soop/commit/4be235a9727ba4400573a82bfa6dd124466dbaae))
* **encoder:** achieve full parity with Python reference encoder ([#105](https://github.com/pleaseai/soop/issues/105)) ([812e16e](https://github.com/pleaseai/soop/commit/812e16ee4661eb3d597635d93f49ac093df25801))
* **encoder:** add git-managed vector embeddings with Float16 codec ([#74](https://github.com/pleaseai/soop/issues/74)) ([d3fdb4d](https://github.com/pleaseai/soop/commit/d3fdb4d0499b1e0aaa17cb94ad1ed6bcc9b4e4c5))
* **encoder:** change default LLM provider to google/gemini-3.1-flash-lite-preview ([#169](https://github.com/pleaseai/soop/issues/169)) ([88e833c](https://github.com/pleaseai/soop/commit/88e833c684b7749a2915a09e5920ba3baf38c1ea))
* **encoder:** implement DependencyGraph with invocation and inheritance tracking ([#83](https://github.com/pleaseai/soop/issues/83)) ([3e21441](https://github.com/pleaseai/soop/commit/3e21441e8f4301886886997381573030eae85603))
* **encoder:** implement token-aware batch semantic extraction ([#82](https://github.com/pleaseai/soop/issues/82)) ([b1f8ad2](https://github.com/pleaseai/soop/commit/b1f8ad25b5d8ccad3940eca2c4014c2ce33e7237))
* **encoder:** implement type-aware call resolution in DependencyGraph ([#90](https://github.com/pleaseai/soop/issues/90)) ([5da75f7](https://github.com/pleaseai/soop/commit/5da75f74a23c91d87aaff29d9d10a066b2ea2bf7))
* **encoder:** improve semantic extraction quality from reference analysis ([#166](https://github.com/pleaseai/soop/issues/166)) ([aa3f980](https://github.com/pleaseai/soop/commit/aa3f980c50d59cdc1c484eefa864a2765a687fe5))
* **encoder:** support flexible 2-5 level hierarchy and evolution area creation ([#155](https://github.com/pleaseai/soop/issues/155)) ([7e12b26](https://github.com/pleaseai/soop/commit/7e12b268f7cf5357435eddcc443425a08831ee13))
* **graph,encoder:** persist DependencyEdge symbols and add cross-boundary excerpts ([#156](https://github.com/pleaseai/soop/issues/156)) ([0fadc4f](https://github.com/pleaseai/soop/commit/0fadc4fe972a1ad91c58f9c769a8054569fb0f6d))
* **namu,ast:** migrate to WASM tree-sitter and extract @pleaseai/soop-ast package ([#185](https://github.com/pleaseai/soop/issues/185)) ([0b29d7a](https://github.com/pleaseai/soop/commit/0b29d7ad39cb80a16bb7bd8766c83c1ec8f00904))
* rebrand from rpg to repo please with monorepo restructure ([#117](https://github.com/pleaseai/soop/issues/117)) ([d4b805a](https://github.com/pleaseai/soop/commit/d4b805abc23f20e8ac3fe1b375c105ba7a6c9b33))
* **store:** add BM25 scoring to LocalTextSearchStore ([#233](https://github.com/pleaseai/soop/issues/233)) ([d04445d](https://github.com/pleaseai/soop/commit/d04445dc81f19e12e7086d6fdb0c6ac48a918195))
* **store:** add zero-dependency local fallback stores and make native deps optional ([#92](https://github.com/pleaseai/soop/issues/92)) ([edf43fe](https://github.com/pleaseai/soop/commit/edf43fe5e25871723ae1742f795471768560380d))
* **utils:** add claude-code LLM provider ([#66](https://github.com/pleaseai/soop/issues/66)) ([00d8ce2](https://github.com/pleaseai/soop/commit/00d8ce2165c568e41ca0cf890e2d328c450fbe25))
* **utils:** add Codex CLI LLM provider ([#73](https://github.com/pleaseai/soop/issues/73)) ([de76959](https://github.com/pleaseai/soop/commit/de76959321b351eb8b760252cc9804473de0dd89))


### Bug Fixes

* **build:** resolve Bun compile errors for cross-platform binary distribution ([#114](https://github.com/pleaseai/soop/issues/114)) ([1f9ce01](https://github.com/pleaseai/soop/commit/1f9ce01e67825b2019733f6c28cdfe984a4379d6))
* **encoder:** convert BigInt attention_mask from ONNX int64 tensors to number ([#220](https://github.com/pleaseai/soop/issues/220)) ([747c10e](https://github.com/pleaseai/soop/commit/747c10e6537c47ca2ce9c91f4073c939a51f0119))
* **encoder:** resolve dependency rebuild UNIQUE constraint and embedding ID mismatch ([#239](https://github.com/pleaseai/soop/issues/239)) ([b43f9a0](https://github.com/pleaseai/soop/commit/b43f9a011c05050d17c1073e92f089b83a765d95))
* **encoder:** resolve voyage-4-nano ONNX model not found in CI ([#217](https://github.com/pleaseai/soop/issues/217)) ([02b5dcd](https://github.com/pleaseai/soop/commit/02b5dcd0acc13b823b63cbda26bcd2aaf66c2154))
* **encoder:** use composite keys in batch prompts to prevent name collision ([#168](https://github.com/pleaseai/soop/issues/168)) ([7138c9c](https://github.com/pleaseai/soop/commit/7138c9c9f03728220024475379b5427e01cff1e2))


### Code Refactoring

* **encoder:** align RPGEncoder API and CLI with reference implementation ([#231](https://github.com/pleaseai/soop/issues/231)) ([9a2a89a](https://github.com/pleaseai/soop/commit/9a2a89a464b265caf951fc54cbe4879d5933d52c))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @pleaseai/soop-graph bumped to 0.1.10

## [0.2.0](https://github.com/pleaseai/soop/compare/soop-encoder-v0.1.10...soop-encoder-v0.2.0) (2026-03-14)


### ⚠ BREAKING CHANGES

* **encoder:** evolve CLI interface changed — requires <repo-path> positional arg, --graph option renamed to -l/--load-path, --stamp flag removed (auto-applied in save()).

### Features

* **store:** add BM25 scoring to LocalTextSearchStore ([#233](https://github.com/pleaseai/soop/issues/233)) ([d04445d](https://github.com/pleaseai/soop/commit/d04445dc81f19e12e7086d6fdb0c6ac48a918195))


### Code Refactoring

* **encoder:** align RPGEncoder API and CLI with reference implementation ([#231](https://github.com/pleaseai/soop/issues/231)) ([9a2a89a](https://github.com/pleaseai/soop/commit/9a2a89a464b265caf951fc54cbe4879d5933d52c))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @pleaseai/soop-graph bumped to 0.1.9
    * @pleaseai/soop-store bumped to 0.1.8
    * @pleaseai/soop-utils bumped to 0.1.8

## [0.1.10](https://github.com/pleaseai/soop/compare/soop-encoder-v0.1.9...soop-encoder-v0.1.10) (2026-03-14)


### Bug Fixes

* **encoder:** convert BigInt attention_mask from ONNX int64 tensors to number ([#220](https://github.com/pleaseai/soop/issues/220)) ([747c10e](https://github.com/pleaseai/soop/commit/747c10e6537c47ca2ce9c91f4073c939a51f0119))

## [0.1.9](https://github.com/pleaseai/soop/compare/soop-encoder-v0.1.8...soop-encoder-v0.1.9) (2026-03-14)


### Bug Fixes

* **encoder:** resolve voyage-4-nano ONNX model not found in CI ([#217](https://github.com/pleaseai/soop/issues/217)) ([02b5dcd](https://github.com/pleaseai/soop/commit/02b5dcd0acc13b823b63cbda26bcd2aaf66c2154))

## [0.1.8](https://github.com/pleaseai/soop/compare/soop-encoder-v0.1.7...soop-encoder-v0.1.8) (2026-03-12)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @pleaseai/soop-graph bumped to 0.1.8
    * @pleaseai/soop-store bumped to 0.1.7

## [0.1.7](https://github.com/pleaseai/soop/compare/soop-encoder-v0.1.6...soop-encoder-v0.1.7) (2026-03-12)


### Features

* **namu,ast:** migrate to WASM tree-sitter and extract @pleaseai/soop-ast package ([#185](https://github.com/pleaseai/soop/issues/185)) ([0b29d7a](https://github.com/pleaseai/soop/commit/0b29d7ad39cb80a16bb7bd8766c83c1ec8f00904))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @pleaseai/soop-graph bumped to 0.1.7
    * @pleaseai/soop-utils bumped to 0.1.7

## [0.1.6](https://github.com/pleaseai/soop/compare/soop-encoder-v0.1.5...soop-encoder-v0.1.6) (2026-03-09)


### Features

* **ast:** add C#, C/C++, Ruby, Kotlin language support and upgrade tree-sitter ([#107](https://github.com/pleaseai/soop/issues/107)) ([4be235a](https://github.com/pleaseai/soop/commit/4be235a9727ba4400573a82bfa6dd124466dbaae))
* **encoder:** achieve full parity with Python reference encoder ([#105](https://github.com/pleaseai/soop/issues/105)) ([812e16e](https://github.com/pleaseai/soop/commit/812e16ee4661eb3d597635d93f49ac093df25801))
* **encoder:** add git-managed vector embeddings with Float16 codec ([#74](https://github.com/pleaseai/soop/issues/74)) ([d3fdb4d](https://github.com/pleaseai/soop/commit/d3fdb4d0499b1e0aaa17cb94ad1ed6bcc9b4e4c5))
* **encoder:** change default LLM provider to google/gemini-3.1-flash-lite-preview ([#169](https://github.com/pleaseai/soop/issues/169)) ([88e833c](https://github.com/pleaseai/soop/commit/88e833c684b7749a2915a09e5920ba3baf38c1ea))
* **encoder:** implement DependencyGraph with invocation and inheritance tracking ([#83](https://github.com/pleaseai/soop/issues/83)) ([3e21441](https://github.com/pleaseai/soop/commit/3e21441e8f4301886886997381573030eae85603))
* **encoder:** implement token-aware batch semantic extraction ([#82](https://github.com/pleaseai/soop/issues/82)) ([b1f8ad2](https://github.com/pleaseai/soop/commit/b1f8ad25b5d8ccad3940eca2c4014c2ce33e7237))
* **encoder:** implement type-aware call resolution in DependencyGraph ([#90](https://github.com/pleaseai/soop/issues/90)) ([5da75f7](https://github.com/pleaseai/soop/commit/5da75f74a23c91d87aaff29d9d10a066b2ea2bf7))
* **encoder:** improve semantic extraction quality from reference analysis ([#166](https://github.com/pleaseai/soop/issues/166)) ([aa3f980](https://github.com/pleaseai/soop/commit/aa3f980c50d59cdc1c484eefa864a2765a687fe5))
* **encoder:** support flexible 2-5 level hierarchy and evolution area creation ([#155](https://github.com/pleaseai/soop/issues/155)) ([7e12b26](https://github.com/pleaseai/soop/commit/7e12b268f7cf5357435eddcc443425a08831ee13))
* **graph,encoder:** persist DependencyEdge symbols and add cross-boundary excerpts ([#156](https://github.com/pleaseai/soop/issues/156)) ([0fadc4f](https://github.com/pleaseai/soop/commit/0fadc4fe972a1ad91c58f9c769a8054569fb0f6d))
* rebrand from rpg to repo please with monorepo restructure ([#117](https://github.com/pleaseai/soop/issues/117)) ([d4b805a](https://github.com/pleaseai/soop/commit/d4b805abc23f20e8ac3fe1b375c105ba7a6c9b33))
* **store:** add zero-dependency local fallback stores and make native deps optional ([#92](https://github.com/pleaseai/soop/issues/92)) ([edf43fe](https://github.com/pleaseai/soop/commit/edf43fe5e25871723ae1742f795471768560380d))
* **utils:** add claude-code LLM provider ([#66](https://github.com/pleaseai/soop/issues/66)) ([00d8ce2](https://github.com/pleaseai/soop/commit/00d8ce2165c568e41ca0cf890e2d328c450fbe25))
* **utils:** add Codex CLI LLM provider ([#73](https://github.com/pleaseai/soop/issues/73)) ([de76959](https://github.com/pleaseai/soop/commit/de76959321b351eb8b760252cc9804473de0dd89))


### Bug Fixes

* **build:** resolve Bun compile errors for cross-platform binary distribution ([#114](https://github.com/pleaseai/soop/issues/114)) ([1f9ce01](https://github.com/pleaseai/soop/commit/1f9ce01e67825b2019733f6c28cdfe984a4379d6))
* **encoder:** use composite keys in batch prompts to prevent name collision ([#168](https://github.com/pleaseai/soop/issues/168)) ([7138c9c](https://github.com/pleaseai/soop/commit/7138c9c9f03728220024475379b5427e01cff1e2))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @pleaseai/soop-graph bumped to 0.1.6
    * @pleaseai/soop-store bumped to 0.1.6
    * @pleaseai/soop-utils bumped to 0.1.6

## [0.1.5](https://github.com/pleaseai/soop/compare/soop-encoder-v0.1.4...soop-encoder-v0.1.5) (2026-03-09)


### Features

* **encoder:** change default LLM provider to google/gemini-3.1-flash-lite-preview ([#169](https://github.com/pleaseai/soop/issues/169)) ([88e833c](https://github.com/pleaseai/soop/commit/88e833c684b7749a2915a09e5920ba3baf38c1ea))
* **encoder:** improve semantic extraction quality from reference analysis ([#166](https://github.com/pleaseai/soop/issues/166)) ([aa3f980](https://github.com/pleaseai/soop/commit/aa3f980c50d59cdc1c484eefa864a2765a687fe5))
* **encoder:** support flexible 2-5 level hierarchy and evolution area creation ([#155](https://github.com/pleaseai/soop/issues/155)) ([7e12b26](https://github.com/pleaseai/soop/commit/7e12b268f7cf5357435eddcc443425a08831ee13))
* **graph,encoder:** persist DependencyEdge symbols and add cross-boundary excerpts ([#156](https://github.com/pleaseai/soop/issues/156)) ([0fadc4f](https://github.com/pleaseai/soop/commit/0fadc4fe972a1ad91c58f9c769a8054569fb0f6d))


### Bug Fixes

* **encoder:** use composite keys in batch prompts to prevent name collision ([#168](https://github.com/pleaseai/soop/issues/168)) ([7138c9c](https://github.com/pleaseai/soop/commit/7138c9c9f03728220024475379b5427e01cff1e2))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @pleaseai/soop-graph bumped to 0.1.5
    * @pleaseai/soop-store bumped to 0.1.5
    * @pleaseai/soop-utils bumped to 0.1.5

## [0.1.4](https://github.com/pleaseai/soop/compare/soop-encoder-v0.1.3...soop-encoder-v0.1.4) (2026-02-25)


### Features

* **ast:** add C#, C/C++, Ruby, Kotlin language support and upgrade tree-sitter ([#107](https://github.com/pleaseai/soop/issues/107)) ([4be235a](https://github.com/pleaseai/soop/commit/4be235a9727ba4400573a82bfa6dd124466dbaae))
* **encoder:** achieve full parity with Python reference encoder ([#105](https://github.com/pleaseai/soop/issues/105)) ([812e16e](https://github.com/pleaseai/soop/commit/812e16ee4661eb3d597635d93f49ac093df25801))
* **encoder:** add git-managed vector embeddings with Float16 codec ([#74](https://github.com/pleaseai/soop/issues/74)) ([d3fdb4d](https://github.com/pleaseai/soop/commit/d3fdb4d0499b1e0aaa17cb94ad1ed6bcc9b4e4c5))
* **encoder:** implement DependencyGraph with invocation and inheritance tracking ([#83](https://github.com/pleaseai/soop/issues/83)) ([3e21441](https://github.com/pleaseai/soop/commit/3e21441e8f4301886886997381573030eae85603))
* **encoder:** implement token-aware batch semantic extraction ([#82](https://github.com/pleaseai/soop/issues/82)) ([b1f8ad2](https://github.com/pleaseai/soop/commit/b1f8ad25b5d8ccad3940eca2c4014c2ce33e7237))
* **encoder:** implement type-aware call resolution in DependencyGraph ([#90](https://github.com/pleaseai/soop/issues/90)) ([5da75f7](https://github.com/pleaseai/soop/commit/5da75f74a23c91d87aaff29d9d10a066b2ea2bf7))
* rebrand from rpg to repo please with monorepo restructure ([#117](https://github.com/pleaseai/soop/issues/117)) ([d4b805a](https://github.com/pleaseai/soop/commit/d4b805abc23f20e8ac3fe1b375c105ba7a6c9b33))
* **store:** add zero-dependency local fallback stores and make native deps optional ([#92](https://github.com/pleaseai/soop/issues/92)) ([edf43fe](https://github.com/pleaseai/soop/commit/edf43fe5e25871723ae1742f795471768560380d))
* **utils:** add claude-code LLM provider ([#66](https://github.com/pleaseai/soop/issues/66)) ([00d8ce2](https://github.com/pleaseai/soop/commit/00d8ce2165c568e41ca0cf890e2d328c450fbe25))
* **utils:** add Codex CLI LLM provider ([#73](https://github.com/pleaseai/soop/issues/73)) ([de76959](https://github.com/pleaseai/soop/commit/de76959321b351eb8b760252cc9804473de0dd89))


### Bug Fixes

* **build:** resolve Bun compile errors for cross-platform binary distribution ([#114](https://github.com/pleaseai/soop/issues/114)) ([1f9ce01](https://github.com/pleaseai/soop/commit/1f9ce01e67825b2019733f6c28cdfe984a4379d6))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @pleaseai/soop-graph bumped to 0.1.4
    * @pleaseai/soop-store bumped to 0.1.4
    * @pleaseai/soop-utils bumped to 0.1.4
