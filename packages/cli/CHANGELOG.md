# Changelog

## [0.3.1](https://github.com/pleaseai/soop/compare/soop-cli-v0.3.0...soop-cli-v0.3.1) (2026-05-27)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @pleaseai/soop-encoder bumped to 0.5.0
    * @pleaseai/soop-mcp bumped to 0.6.0
    * @pleaseai/soop-tools bumped to 0.1.17

## [0.3.0](https://github.com/pleaseai/soop/compare/soop-cli-v0.2.5...soop-cli-v0.3.0) (2026-05-27)


### ⚠ BREAKING CHANGES

* **encoder:** evolve CLI interface changed — requires <repo-path> positional arg, --graph option renamed to -l/--load-path, --stamp flag removed (auto-applied in save()).

### Features

* **cli:** add two-tier RPG data management (CI + local) ([#71](https://github.com/pleaseai/soop/issues/71)) ([2b00bdf](https://github.com/pleaseai/soop/commit/2b00bdf2a6489d6f1224ab344f7cd8d649ce2d8a))
* **cli:** integrate soop-mcp into soop mcp subcommand ([#228](https://github.com/pleaseai/soop/issues/228)) ([8dd7426](https://github.com/pleaseai/soop/commit/8dd74266ce1ca0065a5da91719e1dcb79903f897))
* **encoder:** add dep_graph.json sidecar + HTML visualize stages ([#300](https://github.com/pleaseai/soop/issues/300)) ([f2eb901](https://github.com/pleaseai/soop/commit/f2eb901c1f55034df92b8116b6e736e12ed582ef))
* **encoder:** add git-managed vector embeddings with Float16 codec ([#74](https://github.com/pleaseai/soop/issues/74)) ([d3fdb4d](https://github.com/pleaseai/soop/commit/d3fdb4d0499b1e0aaa17cb94ad1ed6bcc9b4e4c5))
* **encoder:** change default LLM provider to google/gemini-3.1-flash-lite-preview ([#169](https://github.com/pleaseai/soop/issues/169)) ([88e833c](https://github.com/pleaseai/soop/commit/88e833c684b7749a2915a09e5920ba3baf38c1ea))
* **encoder:** implement token-aware batch semantic extraction ([#82](https://github.com/pleaseai/soop/issues/82)) ([b1f8ad2](https://github.com/pleaseai/soop/commit/b1f8ad25b5d8ccad3940eca2c4014c2ce33e7237))
* **encoder:** support flexible 2-5 level hierarchy and evolution area creation ([#155](https://github.com/pleaseai/soop/issues/155)) ([7e12b26](https://github.com/pleaseai/soop/commit/7e12b268f7cf5357435eddcc443425a08831ee13))
* git-grounded sync — silent-fail helpers, decision tree, sentinel-block hooks ([#307](https://github.com/pleaseai/soop/issues/307)) ([cc4388e](https://github.com/pleaseai/soop/commit/cc4388e5c95f125ab020f3b2e6c1152a729cc5be))
* JSONL graph format for git-friendly storage ([#262](https://github.com/pleaseai/soop/issues/262)) ([467ef23](https://github.com/pleaseai/soop/commit/467ef23ea0574056c07be5058bbc39112aa45a9e))
* rebrand from rpg to repo please with monorepo restructure ([#117](https://github.com/pleaseai/soop/issues/117)) ([d4b805a](https://github.com/pleaseai/soop/commit/d4b805abc23f20e8ac3fe1b375c105ba7a6c9b33))
* **store:** add BM25 scoring to LocalTextSearchStore ([#233](https://github.com/pleaseai/soop/issues/233)) ([d04445d](https://github.com/pleaseai/soop/commit/d04445dc81f19e12e7086d6fdb0c6ac48a918195))
* **utils:** add claude-code LLM provider ([#66](https://github.com/pleaseai/soop/issues/66)) ([00d8ce2](https://github.com/pleaseai/soop/commit/00d8ce2165c568e41ca0cf890e2d328c450fbe25))
* **utils:** add Codex CLI LLM provider ([#73](https://github.com/pleaseai/soop/issues/73)) ([de76959](https://github.com/pleaseai/soop/commit/de76959321b351eb8b760252cc9804473de0dd89))


### Bug Fixes

* **build:** resolve Bun compile errors for cross-platform binary distribution ([#114](https://github.com/pleaseai/soop/issues/114)) ([1f9ce01](https://github.com/pleaseai/soop/commit/1f9ce01e67825b2019733f6c28cdfe984a4379d6))
* **encoder:** resolve dependency rebuild UNIQUE constraint and embedding ID mismatch ([#239](https://github.com/pleaseai/soop/issues/239)) ([b43f9a0](https://github.com/pleaseai/soop/commit/b43f9a011c05050d17c1073e92f089b83a765d95))
* **encoder:** spread Map.entries() to array before calling toSorted ([#251](https://github.com/pleaseai/soop/issues/251)) ([8a49ae5](https://github.com/pleaseai/soop/commit/8a49ae5dc0f21f9e684d509382289557e8347889))
* **publish:** bundle workspace packages inline, fix sync vector store, and enable npm provenance ([#96](https://github.com/pleaseai/soop/issues/96)) ([b73033a](https://github.com/pleaseai/soop/commit/b73033a964942e83053fb9a6cf435bb3b7d7bdff))


### Code Refactoring

* **encoder:** align RPGEncoder API and CLI with reference implementation ([#231](https://github.com/pleaseai/soop/issues/231)) ([9a2a89a](https://github.com/pleaseai/soop/commit/9a2a89a464b265caf951fc54cbe4879d5933d52c))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @pleaseai/soop-encoder bumped to 0.4.0
    * @pleaseai/soop-graph bumped to 0.1.13
    * @pleaseai/soop-mcp bumped to 0.5.0
    * @pleaseai/soop-tools bumped to 0.1.16
    * @pleaseai/soop-utils bumped to 0.1.10
    * @pleaseai/soop-zerorepo bumped to 0.1.13

## [0.2.5](https://github.com/pleaseai/soop/compare/soop-cli-v0.2.4...soop-cli-v0.2.5) (2026-04-20)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @pleaseai/soop-encoder bumped to 0.3.3
    * @pleaseai/soop-mcp bumped to 0.4.3
    * @pleaseai/soop-tools bumped to 0.1.15

## [0.2.4](https://github.com/pleaseai/soop/compare/soop-cli-v0.2.3...soop-cli-v0.2.4) (2026-04-02)


### Features

* JSONL graph format for git-friendly storage ([#262](https://github.com/pleaseai/soop/issues/262)) ([467ef23](https://github.com/pleaseai/soop/commit/467ef23ea0574056c07be5058bbc39112aa45a9e))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @pleaseai/soop-encoder bumped to 0.3.2
    * @pleaseai/soop-graph bumped to 0.1.12
    * @pleaseai/soop-mcp bumped to 0.4.2
    * @pleaseai/soop-tools bumped to 0.1.14
    * @pleaseai/soop-zerorepo bumped to 0.1.12

## [0.2.3](https://github.com/pleaseai/soop/compare/soop-cli-v0.2.2...soop-cli-v0.2.3) (2026-03-20)


### Bug Fixes

* **encoder:** spread Map.entries() to array before calling toSorted ([#251](https://github.com/pleaseai/soop/issues/251)) ([8a49ae5](https://github.com/pleaseai/soop/commit/8a49ae5dc0f21f9e684d509382289557e8347889))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @pleaseai/soop-encoder bumped to 0.3.1
    * @pleaseai/soop-graph bumped to 0.1.11
    * @pleaseai/soop-mcp bumped to 0.4.1
    * @pleaseai/soop-store bumped to 0.1.9
    * @pleaseai/soop-tools bumped to 0.1.13
    * @pleaseai/soop-utils bumped to 0.1.9
    * @pleaseai/soop-zerorepo bumped to 0.1.11

## [0.2.2](https://github.com/pleaseai/soop/compare/soop-cli-v0.2.1...soop-cli-v0.2.2) (2026-03-16)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @pleaseai/soop-mcp bumped to 0.4.0

## [0.2.1](https://github.com/pleaseai/soop/compare/soop-cli-v0.2.0...soop-cli-v0.2.1) (2026-03-16)


### Bug Fixes

* **encoder:** resolve dependency rebuild UNIQUE constraint and embedding ID mismatch ([#239](https://github.com/pleaseai/soop/issues/239)) ([b43f9a0](https://github.com/pleaseai/soop/commit/b43f9a011c05050d17c1073e92f089b83a765d95))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @pleaseai/soop-encoder bumped to 0.3.0
    * @pleaseai/soop-graph bumped to 0.1.10
    * @pleaseai/soop-mcp bumped to 0.3.0
    * @pleaseai/soop-tools bumped to 0.1.12
    * @pleaseai/soop-zerorepo bumped to 0.1.10

## [0.2.0](https://github.com/pleaseai/soop/compare/soop-cli-v0.1.11...soop-cli-v0.2.0) (2026-03-14)


### ⚠ BREAKING CHANGES

* **encoder:** evolve CLI interface changed — requires <repo-path> positional arg, --graph option renamed to -l/--load-path, --stamp flag removed (auto-applied in save()).

### Features

* **store:** add BM25 scoring to LocalTextSearchStore ([#233](https://github.com/pleaseai/soop/issues/233)) ([d04445d](https://github.com/pleaseai/soop/commit/d04445dc81f19e12e7086d6fdb0c6ac48a918195))


### Code Refactoring

* **encoder:** align RPGEncoder API and CLI with reference implementation ([#231](https://github.com/pleaseai/soop/issues/231)) ([9a2a89a](https://github.com/pleaseai/soop/commit/9a2a89a464b265caf951fc54cbe4879d5933d52c))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @pleaseai/soop-encoder bumped to 0.2.0
    * @pleaseai/soop-graph bumped to 0.1.9
    * @pleaseai/soop-mcp bumped to 0.2.0
    * @pleaseai/soop-store bumped to 0.1.8
    * @pleaseai/soop-tools bumped to 0.1.11
    * @pleaseai/soop-utils bumped to 0.1.8
    * @pleaseai/soop-zerorepo bumped to 0.1.9

## [0.1.11](https://github.com/pleaseai/soop/compare/soop-cli-v0.1.10...soop-cli-v0.1.11) (2026-03-14)


### Features

* **cli:** integrate soop-mcp into soop mcp subcommand ([#228](https://github.com/pleaseai/soop/issues/228)) ([8dd7426](https://github.com/pleaseai/soop/commit/8dd74266ce1ca0065a5da91719e1dcb79903f897))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @pleaseai/soop-mcp bumped to 0.1.12

## [0.1.10](https://github.com/pleaseai/soop/compare/soop-cli-v0.1.9...soop-cli-v0.1.10) (2026-03-14)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @pleaseai/soop-encoder bumped to 0.1.10
    * @pleaseai/soop-tools bumped to 0.1.10

## [0.1.9](https://github.com/pleaseai/soop/compare/soop-cli-v0.1.8...soop-cli-v0.1.9) (2026-03-14)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @pleaseai/soop-encoder bumped to 0.1.9
    * @pleaseai/soop-tools bumped to 0.1.9

## [0.1.8](https://github.com/pleaseai/soop/compare/soop-cli-v0.1.7...soop-cli-v0.1.8) (2026-03-12)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @pleaseai/soop-encoder bumped to 0.1.8
    * @pleaseai/soop-graph bumped to 0.1.8
    * @pleaseai/soop-store bumped to 0.1.7
    * @pleaseai/soop-tools bumped to 0.1.8
    * @pleaseai/soop-zerorepo bumped to 0.1.8

## [0.1.7](https://github.com/pleaseai/soop/compare/soop-cli-v0.1.6...soop-cli-v0.1.7) (2026-03-12)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @pleaseai/soop-encoder bumped to 0.1.7
    * @pleaseai/soop-graph bumped to 0.1.7
    * @pleaseai/soop-tools bumped to 0.1.7
    * @pleaseai/soop-utils bumped to 0.1.7
    * @pleaseai/soop-zerorepo bumped to 0.1.7

## [0.1.6](https://github.com/pleaseai/soop/compare/soop-cli-v0.1.5...soop-cli-v0.1.6) (2026-03-09)


### Features

* **cli:** add two-tier RPG data management (CI + local) ([#71](https://github.com/pleaseai/soop/issues/71)) ([2b00bdf](https://github.com/pleaseai/soop/commit/2b00bdf2a6489d6f1224ab344f7cd8d649ce2d8a))
* **encoder:** add git-managed vector embeddings with Float16 codec ([#74](https://github.com/pleaseai/soop/issues/74)) ([d3fdb4d](https://github.com/pleaseai/soop/commit/d3fdb4d0499b1e0aaa17cb94ad1ed6bcc9b4e4c5))
* **encoder:** change default LLM provider to google/gemini-3.1-flash-lite-preview ([#169](https://github.com/pleaseai/soop/issues/169)) ([88e833c](https://github.com/pleaseai/soop/commit/88e833c684b7749a2915a09e5920ba3baf38c1ea))
* **encoder:** implement token-aware batch semantic extraction ([#82](https://github.com/pleaseai/soop/issues/82)) ([b1f8ad2](https://github.com/pleaseai/soop/commit/b1f8ad25b5d8ccad3940eca2c4014c2ce33e7237))
* **encoder:** support flexible 2-5 level hierarchy and evolution area creation ([#155](https://github.com/pleaseai/soop/issues/155)) ([7e12b26](https://github.com/pleaseai/soop/commit/7e12b268f7cf5357435eddcc443425a08831ee13))
* rebrand from rpg to repo please with monorepo restructure ([#117](https://github.com/pleaseai/soop/issues/117)) ([d4b805a](https://github.com/pleaseai/soop/commit/d4b805abc23f20e8ac3fe1b375c105ba7a6c9b33))
* **utils:** add claude-code LLM provider ([#66](https://github.com/pleaseai/soop/issues/66)) ([00d8ce2](https://github.com/pleaseai/soop/commit/00d8ce2165c568e41ca0cf890e2d328c450fbe25))
* **utils:** add Codex CLI LLM provider ([#73](https://github.com/pleaseai/soop/issues/73)) ([de76959](https://github.com/pleaseai/soop/commit/de76959321b351eb8b760252cc9804473de0dd89))


### Bug Fixes

* **build:** resolve Bun compile errors for cross-platform binary distribution ([#114](https://github.com/pleaseai/soop/issues/114)) ([1f9ce01](https://github.com/pleaseai/soop/commit/1f9ce01e67825b2019733f6c28cdfe984a4379d6))
* **publish:** bundle workspace packages inline, fix sync vector store, and enable npm provenance ([#96](https://github.com/pleaseai/soop/issues/96)) ([b73033a](https://github.com/pleaseai/soop/commit/b73033a964942e83053fb9a6cf435bb3b7d7bdff))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @pleaseai/soop-encoder bumped to 0.1.6
    * @pleaseai/soop-graph bumped to 0.1.6
    * @pleaseai/soop-store bumped to 0.1.6
    * @pleaseai/soop-tools bumped to 0.1.6
    * @pleaseai/soop-utils bumped to 0.1.6
    * @pleaseai/soop-zerorepo bumped to 0.1.6

## [0.1.5](https://github.com/pleaseai/soop/compare/soop-cli-v0.1.4...soop-cli-v0.1.5) (2026-03-09)


### Features

* **encoder:** change default LLM provider to google/gemini-3.1-flash-lite-preview ([#169](https://github.com/pleaseai/soop/issues/169)) ([88e833c](https://github.com/pleaseai/soop/commit/88e833c684b7749a2915a09e5920ba3baf38c1ea))
* **encoder:** support flexible 2-5 level hierarchy and evolution area creation ([#155](https://github.com/pleaseai/soop/issues/155)) ([7e12b26](https://github.com/pleaseai/soop/commit/7e12b268f7cf5357435eddcc443425a08831ee13))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @pleaseai/soop-encoder bumped to 0.1.5
    * @pleaseai/soop-graph bumped to 0.1.5
    * @pleaseai/soop-store bumped to 0.1.5
    * @pleaseai/soop-tools bumped to 0.1.5
    * @pleaseai/soop-utils bumped to 0.1.5
    * @pleaseai/soop-zerorepo bumped to 0.1.5

## [0.1.4](https://github.com/pleaseai/soop/compare/soop-cli-v0.1.3...soop-cli-v0.1.4) (2026-02-25)


### Features

* **cli:** add two-tier RPG data management (CI + local) ([#71](https://github.com/pleaseai/soop/issues/71)) ([2b00bdf](https://github.com/pleaseai/soop/commit/2b00bdf2a6489d6f1224ab344f7cd8d649ce2d8a))
* **encoder:** add git-managed vector embeddings with Float16 codec ([#74](https://github.com/pleaseai/soop/issues/74)) ([d3fdb4d](https://github.com/pleaseai/soop/commit/d3fdb4d0499b1e0aaa17cb94ad1ed6bcc9b4e4c5))
* **encoder:** implement token-aware batch semantic extraction ([#82](https://github.com/pleaseai/soop/issues/82)) ([b1f8ad2](https://github.com/pleaseai/soop/commit/b1f8ad25b5d8ccad3940eca2c4014c2ce33e7237))
* rebrand from rpg to repo please with monorepo restructure ([#117](https://github.com/pleaseai/soop/issues/117)) ([d4b805a](https://github.com/pleaseai/soop/commit/d4b805abc23f20e8ac3fe1b375c105ba7a6c9b33))
* **utils:** add claude-code LLM provider ([#66](https://github.com/pleaseai/soop/issues/66)) ([00d8ce2](https://github.com/pleaseai/soop/commit/00d8ce2165c568e41ca0cf890e2d328c450fbe25))
* **utils:** add Codex CLI LLM provider ([#73](https://github.com/pleaseai/soop/issues/73)) ([de76959](https://github.com/pleaseai/soop/commit/de76959321b351eb8b760252cc9804473de0dd89))


### Bug Fixes

* **build:** resolve Bun compile errors for cross-platform binary distribution ([#114](https://github.com/pleaseai/soop/issues/114)) ([1f9ce01](https://github.com/pleaseai/soop/commit/1f9ce01e67825b2019733f6c28cdfe984a4379d6))
* **publish:** bundle workspace packages inline, fix sync vector store, and enable npm provenance ([#96](https://github.com/pleaseai/soop/issues/96)) ([b73033a](https://github.com/pleaseai/soop/commit/b73033a964942e83053fb9a6cf435bb3b7d7bdff))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @pleaseai/soop-encoder bumped to 0.1.4
    * @pleaseai/soop-graph bumped to 0.1.4
    * @pleaseai/soop-store bumped to 0.1.4
    * @pleaseai/soop-tools bumped to 0.1.4
    * @pleaseai/soop-utils bumped to 0.1.4
    * @pleaseai/soop-zerorepo bumped to 0.1.4
