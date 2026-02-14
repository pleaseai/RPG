# Changelog

## [0.1.4](https://github.com/pleaseai/RPG/compare/v0.1.3...v0.1.4) (2026-02-14)


### Features

* **ast:** add multi-language support (Rust, Go, Java) ([#68](https://github.com/pleaseai/RPG/issues/68)) ([931b345](https://github.com/pleaseai/RPG/commit/931b3454539e8716637fb7faa759c21385bc6121))
* **cli:** add two-tier RPG data management (CI + local) ([#71](https://github.com/pleaseai/RPG/issues/71)) ([2b00bdf](https://github.com/pleaseai/RPG/commit/2b00bdf2a6489d6f1224ab344f7cd8d649ce2d8a))
* **encoder:** add .gitignore support via git ls-files ([#57](https://github.com/pleaseai/RPG/issues/57)) ([fad382c](https://github.com/pleaseai/RPG/commit/fad382c736d360cd8a9e864fe8ae74de670c7b98))
* **encoder:** add progress logging and incremental cache with token tracking ([#55](https://github.com/pleaseai/RPG/issues/55)) ([4ddd490](https://github.com/pleaseai/RPG/commit/4ddd4909dbcfb912bde3f3751a6e3a3f3e962f75))
* **evals:** add RPG-powered agent evaluation with Next.js codebase ([#42](https://github.com/pleaseai/RPG/issues/42)) ([d2d8c5c](https://github.com/pleaseai/RPG/commit/d2d8c5c9b7334fc0f1d7291dcca3b5de265ce8ef))
* **mcp:** add interactive agent-driven semantic encoding protocol ([#44](https://github.com/pleaseai/RPG/issues/44)) ([0c5c67e](https://github.com/pleaseai/RPG/commit/0c5c67e2eb194b3a53b7ce1e02ba3c7b2773055b))
* **utils:** add claude-code LLM provider ([#66](https://github.com/pleaseai/RPG/issues/66)) ([00d8ce2](https://github.com/pleaseai/RPG/commit/00d8ce2165c568e41ca0cf890e2d328c450fbe25))
* **utils:** add Codex CLI LLM provider ([#73](https://github.com/pleaseai/RPG/issues/73)) ([de76959](https://github.com/pleaseai/RPG/commit/de76959321b351eb8b760252cc9804473de0dd89))

## [0.1.3](https://github.com/pleaseai/rpg/compare/v0.1.2...v0.1.3) (2026-02-10)


### Features

* add agent evaluation framework with Next.js proxy middleware test ([#40](https://github.com/pleaseai/rpg/issues/40)) ([da52f0c](https://github.com/pleaseai/rpg/commit/da52f0c913ffe1450c49252c10f32e07535b49e5))

## [0.1.2](https://github.com/pleaseai/rpg/compare/v0.1.1...v0.1.2) (2026-02-08)


### Features

* **encoder:** implement DataFlowEdge creation ([#36](https://github.com/pleaseai/rpg/issues/36)) ([9eb8906](https://github.com/pleaseai/rpg/commit/9eb8906ec5c4c947e521b351cf55808d225d7f75))
* **encoder:** implement LCA-based artifact grounding with metadata propagation ([#32](https://github.com/pleaseai/rpg/issues/32)) ([dd22aa8](https://github.com/pleaseai/rpg/commit/dd22aa8432f7cb9cfe72b91dfb33a191bef0880a))
* **mcp:** add rpg_evolve tool for incremental RPG updates ([#35](https://github.com/pleaseai/rpg/issues/35)) ([c3f666d](https://github.com/pleaseai/rpg/commit/c3f666dd88df470277b67992735c107b9692caa6))
* **tools:** add search_scopes parameter and auto mode staged fallback ([#34](https://github.com/pleaseai/rpg/issues/34)) ([2cbdf5e](https://github.com/pleaseai/rpg/commit/2cbdf5e4f90d1bd464603124d4e6b681c0346884))

## [0.1.1](https://github.com/pleaseai/rpg/compare/v0.1.0...v0.1.1) (2026-02-06)


### Features

* **encoder:** add HuggingFaceEmbedding with MongoDB LEAF models ([962e5b3](https://github.com/pleaseai/rpg/commit/962e5b3ec1cad37d770d7bf5bcfc97eb0ef620b8))
* **encoder:** implement Domain Discovery and 3-Level Path semantic reorganization ([#12](https://github.com/pleaseai/rpg/issues/12)) ([#30](https://github.com/pleaseai/rpg/issues/30)) ([059db8e](https://github.com/pleaseai/rpg/commit/059db8e466e4dd57d33f1f3eceee69a3cbdb53d6))
* **encoder:** implement RPG-Encoder Evolution — commit-level incremental updates ([#28](https://github.com/pleaseai/rpg/issues/28)) ([499a223](https://github.com/pleaseai/rpg/commit/499a223d86359e9651c5fbeaafd55694c614ea23))
* **encoder:** implement RPGEncoder for repository-to-graph encoding ([#4](https://github.com/pleaseai/rpg/issues/4)) ([c3b3f1c](https://github.com/pleaseai/rpg/commit/c3b3f1c7b789971b57eb675eca54f9d86ba16fbe)), closes [#3](https://github.com/pleaseai/rpg/issues/3)
* **encoder:** improve semantic lifting with naming rules and file-level aggregation ([#29](https://github.com/pleaseai/rpg/issues/29)) ([79b89f3](https://github.com/pleaseai/rpg/commit/79b89f3a481a0d8925ec137cff1c7f7616a455c0))
* **graph:** add GraphStore interface with SQLite and SurrealDB implementations ([d300798](https://github.com/pleaseai/rpg/commit/d300798baaa9062c3aa13b89f43245aee7ac575a))
* implement MCP server with 5 tools and comprehensive testing ([#2](https://github.com/pleaseai/rpg/issues/2)) ([fa15a08](https://github.com/pleaseai/rpg/commit/fa15a08860ee2533827cd99b671889e600ff4a4a)), closes [#1](https://github.com/pleaseai/rpg/issues/1)
* initial implementation of RPG (Repository Planning Graph) ([f3b3d47](https://github.com/pleaseai/rpg/commit/f3b3d471c84e364b82dd4ffddce8cc90992b1b5d))
* **mcp:** integrate semantic search with HuggingFace embedding ([983f411](https://github.com/pleaseai/rpg/commit/983f41150e564efdb9c7af13d852c35e19fab5bb))
* **search:** add hybrid search with vector + BM25 full-text via LanceDB ([6fda2ac](https://github.com/pleaseai/rpg/commit/6fda2acac331bf0456c34ab152911664fd9bce47))
