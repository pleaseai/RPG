# Changelog

## [0.1.13](https://github.com/pleaseai/soop/compare/soop-graph-v0.1.12...soop-graph-v0.1.13) (2026-05-27)


### Features

* **encoder:** add dep_graph.json sidecar + HTML visualize stages ([#300](https://github.com/pleaseai/soop/issues/300)) ([f2eb901](https://github.com/pleaseai/soop/commit/f2eb901c1f55034df92b8116b6e736e12ed582ef))
* git-grounded sync — silent-fail helpers, decision tree, sentinel-block hooks ([#307](https://github.com/pleaseai/soop/issues/307)) ([cc4388e](https://github.com/pleaseai/soop/commit/cc4388e5c95f125ab020f3b2e6c1152a729cc5be))
* **mcp:** add soop_tree, fuzzy suggestions, and RPG-Kit parity fixes ([#299](https://github.com/pleaseai/soop/issues/299)) ([c5cb889](https://github.com/pleaseai/soop/commit/c5cb889d89f4d4089fafee8920f54febfcf788cb))


### Bug Fixes

* **graph:** store meta rootPath relative to graph file for portability ([#295](https://github.com/pleaseai/soop/issues/295)) ([6c52dfd](https://github.com/pleaseai/soop/commit/6c52dfd3f65f2b90c3b5e384a92a2a377adc4122))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @pleaseai/soop-utils bumped to 0.1.10

## [0.1.12](https://github.com/pleaseai/soop/compare/soop-graph-v0.1.11...soop-graph-v0.1.12) (2026-04-02)


### Features

* JSONL graph format for git-friendly storage ([#262](https://github.com/pleaseai/soop/issues/262)) ([467ef23](https://github.com/pleaseai/soop/commit/467ef23ea0574056c07be5058bbc39112aa45a9e))

## [0.1.11](https://github.com/pleaseai/soop/compare/soop-graph-v0.1.10...soop-graph-v0.1.11) (2026-03-20)


### Bug Fixes

* **encoder:** spread Map.entries() to array before calling toSorted ([#251](https://github.com/pleaseai/soop/issues/251)) ([8a49ae5](https://github.com/pleaseai/soop/commit/8a49ae5dc0f21f9e684d509382289557e8347889))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @pleaseai/soop-store bumped to 0.1.9
    * @pleaseai/soop-utils bumped to 0.1.9

## [0.1.10](https://github.com/pleaseai/soop/compare/soop-graph-v0.1.9...soop-graph-v0.1.10) (2026-03-16)


### Bug Fixes

* **encoder:** resolve dependency rebuild UNIQUE constraint and embedding ID mismatch ([#239](https://github.com/pleaseai/soop/issues/239)) ([b43f9a0](https://github.com/pleaseai/soop/commit/b43f9a011c05050d17c1073e92f089b83a765d95))

## [0.1.9](https://github.com/pleaseai/soop/compare/soop-graph-v0.1.8...soop-graph-v0.1.9) (2026-03-14)


### Features

* **store:** add BM25 scoring to LocalTextSearchStore ([#233](https://github.com/pleaseai/soop/issues/233)) ([d04445d](https://github.com/pleaseai/soop/commit/d04445dc81f19e12e7086d6fdb0c6ac48a918195))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @pleaseai/soop-store bumped to 0.1.8
    * @pleaseai/soop-utils bumped to 0.1.8

## [0.1.8](https://github.com/pleaseai/soop/compare/soop-graph-v0.1.7...soop-graph-v0.1.8) (2026-03-12)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @pleaseai/soop-store bumped to 0.1.7

## [0.1.7](https://github.com/pleaseai/soop/compare/soop-graph-v0.1.6...soop-graph-v0.1.7) (2026-03-12)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @pleaseai/soop-utils bumped to 0.1.7

## [0.1.6](https://github.com/pleaseai/soop/compare/soop-graph-v0.1.5...soop-graph-v0.1.6) (2026-03-09)


### Features

* **cli:** add two-tier RPG data management (CI + local) ([#71](https://github.com/pleaseai/soop/issues/71)) ([2b00bdf](https://github.com/pleaseai/soop/commit/2b00bdf2a6489d6f1224ab344f7cd8d649ce2d8a))
* **encoder:** add git-managed vector embeddings with Float16 codec ([#74](https://github.com/pleaseai/soop/issues/74)) ([d3fdb4d](https://github.com/pleaseai/soop/commit/d3fdb4d0499b1e0aaa17cb94ad1ed6bcc9b4e4c5))
* **encoder:** change default LLM provider to google/gemini-3.1-flash-lite-preview ([#169](https://github.com/pleaseai/soop/issues/169)) ([88e833c](https://github.com/pleaseai/soop/commit/88e833c684b7749a2915a09e5920ba3baf38c1ea))
* **encoder:** implement DependencyGraph with invocation and inheritance tracking ([#83](https://github.com/pleaseai/soop/issues/83)) ([3e21441](https://github.com/pleaseai/soop/commit/3e21441e8f4301886886997381573030eae85603))
* **encoder:** support flexible 2-5 level hierarchy and evolution area creation ([#155](https://github.com/pleaseai/soop/issues/155)) ([7e12b26](https://github.com/pleaseai/soop/commit/7e12b268f7cf5357435eddcc443425a08831ee13))
* **graph,encoder:** persist DependencyEdge symbols and add cross-boundary excerpts ([#156](https://github.com/pleaseai/soop/issues/156)) ([0fadc4f](https://github.com/pleaseai/soop/commit/0fadc4fe972a1ad91c58f9c769a8054569fb0f6d))
* rebrand from rpg to repo please with monorepo restructure ([#117](https://github.com/pleaseai/soop/issues/117)) ([d4b805a](https://github.com/pleaseai/soop/commit/d4b805abc23f20e8ac3fe1b375c105ba7a6c9b33))


### Bug Fixes

* **build:** resolve Bun compile errors for cross-platform binary distribution ([#114](https://github.com/pleaseai/soop/issues/114)) ([1f9ce01](https://github.com/pleaseai/soop/commit/1f9ce01e67825b2019733f6c28cdfe984a4379d6))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @pleaseai/soop-store bumped to 0.1.6
    * @pleaseai/soop-utils bumped to 0.1.6

## [0.1.5](https://github.com/pleaseai/soop/compare/soop-graph-v0.1.4...soop-graph-v0.1.5) (2026-03-09)


### Features

* **encoder:** change default LLM provider to google/gemini-3.1-flash-lite-preview ([#169](https://github.com/pleaseai/soop/issues/169)) ([88e833c](https://github.com/pleaseai/soop/commit/88e833c684b7749a2915a09e5920ba3baf38c1ea))
* **encoder:** support flexible 2-5 level hierarchy and evolution area creation ([#155](https://github.com/pleaseai/soop/issues/155)) ([7e12b26](https://github.com/pleaseai/soop/commit/7e12b268f7cf5357435eddcc443425a08831ee13))
* **graph,encoder:** persist DependencyEdge symbols and add cross-boundary excerpts ([#156](https://github.com/pleaseai/soop/issues/156)) ([0fadc4f](https://github.com/pleaseai/soop/commit/0fadc4fe972a1ad91c58f9c769a8054569fb0f6d))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @pleaseai/soop-store bumped to 0.1.5
    * @pleaseai/soop-utils bumped to 0.1.5

## [0.1.4](https://github.com/pleaseai/soop/compare/soop-graph-v0.1.3...soop-graph-v0.1.4) (2026-02-25)


### Features

* **cli:** add two-tier RPG data management (CI + local) ([#71](https://github.com/pleaseai/soop/issues/71)) ([2b00bdf](https://github.com/pleaseai/soop/commit/2b00bdf2a6489d6f1224ab344f7cd8d649ce2d8a))
* **encoder:** add git-managed vector embeddings with Float16 codec ([#74](https://github.com/pleaseai/soop/issues/74)) ([d3fdb4d](https://github.com/pleaseai/soop/commit/d3fdb4d0499b1e0aaa17cb94ad1ed6bcc9b4e4c5))
* **encoder:** implement DependencyGraph with invocation and inheritance tracking ([#83](https://github.com/pleaseai/soop/issues/83)) ([3e21441](https://github.com/pleaseai/soop/commit/3e21441e8f4301886886997381573030eae85603))
* rebrand from rpg to repo please with monorepo restructure ([#117](https://github.com/pleaseai/soop/issues/117)) ([d4b805a](https://github.com/pleaseai/soop/commit/d4b805abc23f20e8ac3fe1b375c105ba7a6c9b33))


### Bug Fixes

* **build:** resolve Bun compile errors for cross-platform binary distribution ([#114](https://github.com/pleaseai/soop/issues/114)) ([1f9ce01](https://github.com/pleaseai/soop/commit/1f9ce01e67825b2019733f6c28cdfe984a4379d6))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @pleaseai/soop-store bumped to 0.1.4
    * @pleaseai/soop-utils bumped to 0.1.4
