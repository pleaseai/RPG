# Changelog

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
