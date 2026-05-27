# Changelog

## [0.5.0](https://github.com/pleaseai/soop/compare/soop-mcp-v0.4.3...soop-mcp-v0.5.0) (2026-05-27)


### ⚠ BREAKING CHANGES

* **encoder:** evolve CLI interface changed — requires <repo-path> positional arg, --graph option renamed to -l/--load-path, --stamp flag removed (auto-applied in save()).

### Features

* **cli:** integrate soop-mcp into soop mcp subcommand ([#228](https://github.com/pleaseai/soop/issues/228)) ([8dd7426](https://github.com/pleaseai/soop/commit/8dd74266ce1ca0065a5da91719e1dcb79903f897))
* **encoder:** add git-managed vector embeddings with Float16 codec ([#74](https://github.com/pleaseai/soop/issues/74)) ([d3fdb4d](https://github.com/pleaseai/soop/commit/d3fdb4d0499b1e0aaa17cb94ad1ed6bcc9b4e4c5))
* **encoder:** support flexible 2-5 level hierarchy and evolution area creation ([#155](https://github.com/pleaseai/soop/issues/155)) ([7e12b26](https://github.com/pleaseai/soop/commit/7e12b268f7cf5357435eddcc443425a08831ee13))
* JSONL graph format for git-friendly storage ([#262](https://github.com/pleaseai/soop/issues/262)) ([467ef23](https://github.com/pleaseai/soop/commit/467ef23ea0574056c07be5058bbc39112aa45a9e))
* **mcp:** add soop_tree, fuzzy suggestions, and RPG-Kit parity fixes ([#299](https://github.com/pleaseai/soop/issues/299)) ([c5cb889](https://github.com/pleaseai/soop/commit/c5cb889d89f4d4089fafee8920f54febfcf788cb))
* **mcp:** graceful startup, lazy reload, and actionable error payloads ([#296](https://github.com/pleaseai/soop/issues/296)) ([891a45c](https://github.com/pleaseai/soop/commit/891a45ce96b1a7a9d0dad44d039c690dc1135eff))
* **namu,ast:** migrate to WASM tree-sitter and extract @pleaseai/soop-ast package ([#185](https://github.com/pleaseai/soop/issues/185)) ([0b29d7a](https://github.com/pleaseai/soop/commit/0b29d7ad39cb80a16bb7bd8766c83c1ec8f00904))
* rebrand from rpg to repo please with monorepo restructure ([#117](https://github.com/pleaseai/soop/issues/117)) ([d4b805a](https://github.com/pleaseai/soop/commit/d4b805abc23f20e8ac3fe1b375c105ba7a6c9b33))
* **store:** add BM25 scoring to LocalTextSearchStore ([#233](https://github.com/pleaseai/soop/issues/233)) ([d04445d](https://github.com/pleaseai/soop/commit/d04445dc81f19e12e7086d6fdb0c6ac48a918195))
* **store:** add zero-dependency local fallback stores and make native deps optional ([#92](https://github.com/pleaseai/soop/issues/92)) ([edf43fe](https://github.com/pleaseai/soop/commit/edf43fe5e25871723ae1742f795471768560380d))


### Bug Fixes

* **build:** resolve Bun compile errors for cross-platform binary distribution ([#114](https://github.com/pleaseai/soop/issues/114)) ([1f9ce01](https://github.com/pleaseai/soop/commit/1f9ce01e67825b2019733f6c28cdfe984a4379d6))
* **encoder:** spread Map before toSorted to avoid iterator error ([#282](https://github.com/pleaseai/soop/issues/282)) ([03b462e](https://github.com/pleaseai/soop/commit/03b462ed82270b28b5e7d39e3cb5b01faeaf6680))
* **encoder:** spread Map.entries() to array before calling toSorted ([#251](https://github.com/pleaseai/soop/issues/251)) ([8a49ae5](https://github.com/pleaseai/soop/commit/8a49ae5dc0f21f9e684d509382289557e8347889))
* **graph:** store meta rootPath relative to graph file for portability ([#295](https://github.com/pleaseai/soop/issues/295)) ([6c52dfd](https://github.com/pleaseai/soop/commit/6c52dfd3f65f2b90c3b5e384a92a2a377adc4122))
* **mcp:** replace top-level await with promise chain for cross-compilation ([#173](https://github.com/pleaseai/soop/issues/173)) ([a14303d](https://github.com/pleaseai/soop/commit/a14303d8cf8d3dd1f1887eda1432976440ed59b1))
* **mcp:** use basename for vector store path to prevent nested directories ([#235](https://github.com/pleaseai/soop/issues/235)) ([84e4d07](https://github.com/pleaseai/soop/commit/84e4d0767732233ab00c4d8cdd81661f15a633e7))


### Code Refactoring

* **encoder:** align RPGEncoder API and CLI with reference implementation ([#231](https://github.com/pleaseai/soop/issues/231)) ([9a2a89a](https://github.com/pleaseai/soop/commit/9a2a89a464b265caf951fc54cbe4879d5933d52c))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @pleaseai/soop-graph bumped to 0.1.13
    * @pleaseai/soop-encoder bumped to 0.4.0
    * @pleaseai/soop-tools bumped to 0.1.16
    * @pleaseai/soop-utils bumped to 0.1.10

## [0.4.3](https://github.com/pleaseai/soop/compare/soop-mcp-v0.4.2...soop-mcp-v0.4.3) (2026-04-20)


### Bug Fixes

* **encoder:** spread Map before toSorted to avoid iterator error ([#282](https://github.com/pleaseai/soop/issues/282)) ([03b462e](https://github.com/pleaseai/soop/commit/03b462ed82270b28b5e7d39e3cb5b01faeaf6680))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @pleaseai/soop-encoder bumped to 0.3.3
    * @pleaseai/soop-tools bumped to 0.1.15

## [0.4.2](https://github.com/pleaseai/soop/compare/soop-mcp-v0.4.1...soop-mcp-v0.4.2) (2026-04-02)


### Features

* JSONL graph format for git-friendly storage ([#262](https://github.com/pleaseai/soop/issues/262)) ([467ef23](https://github.com/pleaseai/soop/commit/467ef23ea0574056c07be5058bbc39112aa45a9e))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @pleaseai/soop-graph bumped to 0.1.12
    * @pleaseai/soop-encoder bumped to 0.3.2
    * @pleaseai/soop-tools bumped to 0.1.14

## [0.4.1](https://github.com/pleaseai/soop/compare/soop-mcp-v0.4.0...soop-mcp-v0.4.1) (2026-03-20)


### Bug Fixes

* **encoder:** spread Map.entries() to array before calling toSorted ([#251](https://github.com/pleaseai/soop/issues/251)) ([8a49ae5](https://github.com/pleaseai/soop/commit/8a49ae5dc0f21f9e684d509382289557e8347889))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @pleaseai/soop-graph bumped to 0.1.11
    * @pleaseai/soop-encoder bumped to 0.3.1
    * @pleaseai/soop-store bumped to 0.1.9
    * @pleaseai/soop-tools bumped to 0.1.13
    * @pleaseai/soop-utils bumped to 0.1.9

## [0.4.0](https://github.com/pleaseai/soop/compare/soop-mcp-v0.3.0...soop-mcp-v0.4.0) (2026-03-16)


### ⚠ BREAKING CHANGES

* **encoder:** evolve CLI interface changed — requires <repo-path> positional arg, --graph option renamed to -l/--load-path, --stamp flag removed (auto-applied in save()).

### Features

* **cli:** integrate soop-mcp into soop mcp subcommand ([#228](https://github.com/pleaseai/soop/issues/228)) ([8dd7426](https://github.com/pleaseai/soop/commit/8dd74266ce1ca0065a5da91719e1dcb79903f897))
* **encoder:** add git-managed vector embeddings with Float16 codec ([#74](https://github.com/pleaseai/soop/issues/74)) ([d3fdb4d](https://github.com/pleaseai/soop/commit/d3fdb4d0499b1e0aaa17cb94ad1ed6bcc9b4e4c5))
* **encoder:** support flexible 2-5 level hierarchy and evolution area creation ([#155](https://github.com/pleaseai/soop/issues/155)) ([7e12b26](https://github.com/pleaseai/soop/commit/7e12b268f7cf5357435eddcc443425a08831ee13))
* **namu,ast:** migrate to WASM tree-sitter and extract @pleaseai/soop-ast package ([#185](https://github.com/pleaseai/soop/issues/185)) ([0b29d7a](https://github.com/pleaseai/soop/commit/0b29d7ad39cb80a16bb7bd8766c83c1ec8f00904))
* rebrand from rpg to repo please with monorepo restructure ([#117](https://github.com/pleaseai/soop/issues/117)) ([d4b805a](https://github.com/pleaseai/soop/commit/d4b805abc23f20e8ac3fe1b375c105ba7a6c9b33))
* **store:** add BM25 scoring to LocalTextSearchStore ([#233](https://github.com/pleaseai/soop/issues/233)) ([d04445d](https://github.com/pleaseai/soop/commit/d04445dc81f19e12e7086d6fdb0c6ac48a918195))
* **store:** add zero-dependency local fallback stores and make native deps optional ([#92](https://github.com/pleaseai/soop/issues/92)) ([edf43fe](https://github.com/pleaseai/soop/commit/edf43fe5e25871723ae1742f795471768560380d))


### Bug Fixes

* **build:** resolve Bun compile errors for cross-platform binary distribution ([#114](https://github.com/pleaseai/soop/issues/114)) ([1f9ce01](https://github.com/pleaseai/soop/commit/1f9ce01e67825b2019733f6c28cdfe984a4379d6))
* **mcp:** replace top-level await with promise chain for cross-compilation ([#173](https://github.com/pleaseai/soop/issues/173)) ([a14303d](https://github.com/pleaseai/soop/commit/a14303d8cf8d3dd1f1887eda1432976440ed59b1))
* **mcp:** use basename for vector store path to prevent nested directories ([#235](https://github.com/pleaseai/soop/issues/235)) ([84e4d07](https://github.com/pleaseai/soop/commit/84e4d0767732233ab00c4d8cdd81661f15a633e7))


### Code Refactoring

* **encoder:** align RPGEncoder API and CLI with reference implementation ([#231](https://github.com/pleaseai/soop/issues/231)) ([9a2a89a](https://github.com/pleaseai/soop/commit/9a2a89a464b265caf951fc54cbe4879d5933d52c))

## [0.3.0](https://github.com/pleaseai/soop/compare/soop-mcp-v0.2.0...soop-mcp-v0.3.0) (2026-03-16)


### ⚠ BREAKING CHANGES

* **encoder:** evolve CLI interface changed — requires <repo-path> positional arg, --graph option renamed to -l/--load-path, --stamp flag removed (auto-applied in save()).

### Features

* **cli:** integrate soop-mcp into soop mcp subcommand ([#228](https://github.com/pleaseai/soop/issues/228)) ([8dd7426](https://github.com/pleaseai/soop/commit/8dd74266ce1ca0065a5da91719e1dcb79903f897))
* **encoder:** add git-managed vector embeddings with Float16 codec ([#74](https://github.com/pleaseai/soop/issues/74)) ([d3fdb4d](https://github.com/pleaseai/soop/commit/d3fdb4d0499b1e0aaa17cb94ad1ed6bcc9b4e4c5))
* **encoder:** support flexible 2-5 level hierarchy and evolution area creation ([#155](https://github.com/pleaseai/soop/issues/155)) ([7e12b26](https://github.com/pleaseai/soop/commit/7e12b268f7cf5357435eddcc443425a08831ee13))
* **namu,ast:** migrate to WASM tree-sitter and extract @pleaseai/soop-ast package ([#185](https://github.com/pleaseai/soop/issues/185)) ([0b29d7a](https://github.com/pleaseai/soop/commit/0b29d7ad39cb80a16bb7bd8766c83c1ec8f00904))
* rebrand from rpg to repo please with monorepo restructure ([#117](https://github.com/pleaseai/soop/issues/117)) ([d4b805a](https://github.com/pleaseai/soop/commit/d4b805abc23f20e8ac3fe1b375c105ba7a6c9b33))
* **store:** add BM25 scoring to LocalTextSearchStore ([#233](https://github.com/pleaseai/soop/issues/233)) ([d04445d](https://github.com/pleaseai/soop/commit/d04445dc81f19e12e7086d6fdb0c6ac48a918195))
* **store:** add zero-dependency local fallback stores and make native deps optional ([#92](https://github.com/pleaseai/soop/issues/92)) ([edf43fe](https://github.com/pleaseai/soop/commit/edf43fe5e25871723ae1742f795471768560380d))


### Bug Fixes

* **build:** resolve Bun compile errors for cross-platform binary distribution ([#114](https://github.com/pleaseai/soop/issues/114)) ([1f9ce01](https://github.com/pleaseai/soop/commit/1f9ce01e67825b2019733f6c28cdfe984a4379d6))
* **mcp:** replace top-level await with promise chain for cross-compilation ([#173](https://github.com/pleaseai/soop/issues/173)) ([a14303d](https://github.com/pleaseai/soop/commit/a14303d8cf8d3dd1f1887eda1432976440ed59b1))
* **mcp:** use basename for vector store path to prevent nested directories ([#235](https://github.com/pleaseai/soop/issues/235)) ([84e4d07](https://github.com/pleaseai/soop/commit/84e4d0767732233ab00c4d8cdd81661f15a633e7))


### Code Refactoring

* **encoder:** align RPGEncoder API and CLI with reference implementation ([#231](https://github.com/pleaseai/soop/issues/231)) ([9a2a89a](https://github.com/pleaseai/soop/commit/9a2a89a464b265caf951fc54cbe4879d5933d52c))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @pleaseai/soop-graph bumped to 0.1.10
    * @pleaseai/soop-encoder bumped to 0.3.0
    * @pleaseai/soop-tools bumped to 0.1.12

## [0.2.0](https://github.com/pleaseai/soop/compare/soop-mcp-v0.1.12...soop-mcp-v0.2.0) (2026-03-14)


### ⚠ BREAKING CHANGES

* **encoder:** evolve CLI interface changed — requires <repo-path> positional arg, --graph option renamed to -l/--load-path, --stamp flag removed (auto-applied in save()).

### Features

* **store:** add BM25 scoring to LocalTextSearchStore ([#233](https://github.com/pleaseai/soop/issues/233)) ([d04445d](https://github.com/pleaseai/soop/commit/d04445dc81f19e12e7086d6fdb0c6ac48a918195))


### Bug Fixes

* **mcp:** use basename for vector store path to prevent nested directories ([#235](https://github.com/pleaseai/soop/issues/235)) ([84e4d07](https://github.com/pleaseai/soop/commit/84e4d0767732233ab00c4d8cdd81661f15a633e7))


### Code Refactoring

* **encoder:** align RPGEncoder API and CLI with reference implementation ([#231](https://github.com/pleaseai/soop/issues/231)) ([9a2a89a](https://github.com/pleaseai/soop/commit/9a2a89a464b265caf951fc54cbe4879d5933d52c))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @pleaseai/soop-graph bumped to 0.1.9
    * @pleaseai/soop-encoder bumped to 0.2.0
    * @pleaseai/soop-store bumped to 0.1.8
    * @pleaseai/soop-tools bumped to 0.1.11
    * @pleaseai/soop-utils bumped to 0.1.8

## [0.1.12](https://github.com/pleaseai/soop/compare/soop-mcp-v0.1.11...soop-mcp-v0.1.12) (2026-03-14)


### Features

* **cli:** integrate soop-mcp into soop mcp subcommand ([#228](https://github.com/pleaseai/soop/issues/228)) ([8dd7426](https://github.com/pleaseai/soop/commit/8dd74266ce1ca0065a5da91719e1dcb79903f897))

## [0.1.11](https://github.com/pleaseai/soop/compare/soop-mcp-v0.1.10...soop-mcp-v0.1.11) (2026-03-14)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @pleaseai/soop-encoder bumped to 0.1.10
    * @pleaseai/soop-tools bumped to 0.1.10

## [0.1.10](https://github.com/pleaseai/soop/compare/soop-mcp-v0.1.9...soop-mcp-v0.1.10) (2026-03-14)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @pleaseai/soop-encoder bumped to 0.1.9
    * @pleaseai/soop-tools bumped to 0.1.9

## [0.1.9](https://github.com/pleaseai/soop/compare/soop-mcp-v0.1.8...soop-mcp-v0.1.9) (2026-03-12)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @pleaseai/soop-graph bumped to 0.1.8
    * @pleaseai/soop-encoder bumped to 0.1.8
    * @pleaseai/soop-store bumped to 0.1.7
    * @pleaseai/soop-tools bumped to 0.1.8

## [0.1.8](https://github.com/pleaseai/soop/compare/soop-mcp-v0.1.7...soop-mcp-v0.1.8) (2026-03-12)


### Features

* **namu,ast:** migrate to WASM tree-sitter and extract @pleaseai/soop-ast package ([#185](https://github.com/pleaseai/soop/issues/185)) ([0b29d7a](https://github.com/pleaseai/soop/commit/0b29d7ad39cb80a16bb7bd8766c83c1ec8f00904))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @pleaseai/soop-graph bumped to 0.1.7
    * @pleaseai/soop-encoder bumped to 0.1.7
    * @pleaseai/soop-tools bumped to 0.1.7
    * @pleaseai/soop-utils bumped to 0.1.7

## [0.1.7](https://github.com/pleaseai/soop/compare/soop-mcp-v0.1.6...soop-mcp-v0.1.7) (2026-03-09)


### Bug Fixes

* **mcp:** replace top-level await with promise chain for cross-compilation ([#173](https://github.com/pleaseai/soop/issues/173)) ([a14303d](https://github.com/pleaseai/soop/commit/a14303d8cf8d3dd1f1887eda1432976440ed59b1))

## [0.1.6](https://github.com/pleaseai/soop/compare/soop-mcp-v0.1.5...soop-mcp-v0.1.6) (2026-03-09)


### Features

* **encoder:** add git-managed vector embeddings with Float16 codec ([#74](https://github.com/pleaseai/soop/issues/74)) ([d3fdb4d](https://github.com/pleaseai/soop/commit/d3fdb4d0499b1e0aaa17cb94ad1ed6bcc9b4e4c5))
* **encoder:** support flexible 2-5 level hierarchy and evolution area creation ([#155](https://github.com/pleaseai/soop/issues/155)) ([7e12b26](https://github.com/pleaseai/soop/commit/7e12b268f7cf5357435eddcc443425a08831ee13))
* rebrand from rpg to repo please with monorepo restructure ([#117](https://github.com/pleaseai/soop/issues/117)) ([d4b805a](https://github.com/pleaseai/soop/commit/d4b805abc23f20e8ac3fe1b375c105ba7a6c9b33))
* **store:** add zero-dependency local fallback stores and make native deps optional ([#92](https://github.com/pleaseai/soop/issues/92)) ([edf43fe](https://github.com/pleaseai/soop/commit/edf43fe5e25871723ae1742f795471768560380d))


### Bug Fixes

* **build:** resolve Bun compile errors for cross-platform binary distribution ([#114](https://github.com/pleaseai/soop/issues/114)) ([1f9ce01](https://github.com/pleaseai/soop/commit/1f9ce01e67825b2019733f6c28cdfe984a4379d6))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @pleaseai/soop-graph bumped to 0.1.6
    * @pleaseai/soop-encoder bumped to 0.1.6
    * @pleaseai/soop-store bumped to 0.1.6
    * @pleaseai/soop-tools bumped to 0.1.6
    * @pleaseai/soop-utils bumped to 0.1.6

## [0.1.5](https://github.com/pleaseai/soop/compare/soop-mcp-v0.1.4...soop-mcp-v0.1.5) (2026-03-09)


### Features

* **encoder:** support flexible 2-5 level hierarchy and evolution area creation ([#155](https://github.com/pleaseai/soop/issues/155)) ([7e12b26](https://github.com/pleaseai/soop/commit/7e12b268f7cf5357435eddcc443425a08831ee13))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @pleaseai/soop-graph bumped to 0.1.5
    * @pleaseai/soop-encoder bumped to 0.1.5
    * @pleaseai/soop-store bumped to 0.1.5
    * @pleaseai/soop-tools bumped to 0.1.5
    * @pleaseai/soop-utils bumped to 0.1.5

## [0.1.4](https://github.com/pleaseai/soop/compare/soop-mcp-v0.1.3...soop-mcp-v0.1.4) (2026-02-25)


### Features

* **encoder:** add git-managed vector embeddings with Float16 codec ([#74](https://github.com/pleaseai/soop/issues/74)) ([d3fdb4d](https://github.com/pleaseai/soop/commit/d3fdb4d0499b1e0aaa17cb94ad1ed6bcc9b4e4c5))
* rebrand from rpg to repo please with monorepo restructure ([#117](https://github.com/pleaseai/soop/issues/117)) ([d4b805a](https://github.com/pleaseai/soop/commit/d4b805abc23f20e8ac3fe1b375c105ba7a6c9b33))
* **store:** add zero-dependency local fallback stores and make native deps optional ([#92](https://github.com/pleaseai/soop/issues/92)) ([edf43fe](https://github.com/pleaseai/soop/commit/edf43fe5e25871723ae1742f795471768560380d))


### Bug Fixes

* **build:** resolve Bun compile errors for cross-platform binary distribution ([#114](https://github.com/pleaseai/soop/issues/114)) ([1f9ce01](https://github.com/pleaseai/soop/commit/1f9ce01e67825b2019733f6c28cdfe984a4379d6))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @pleaseai/soop-graph bumped to 0.1.4
    * @pleaseai/soop-encoder bumped to 0.1.4
    * @pleaseai/soop-store bumped to 0.1.4
    * @pleaseai/soop-tools bumped to 0.1.4
    * @pleaseai/soop-utils bumped to 0.1.4
