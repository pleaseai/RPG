# Architecture

This document provides a bird's-eye view of the **soop please** codebase.
See also [CLAUDE.md](./CLAUDE.md) for development commands and conventions.

## Overview

soop please is a TypeScript/Bun implementation of two research papers on repository-level code understanding and generation:

- **RPG-Encoder** (Code → Intent): Encodes a codebase into a Repository Planning Graph (RPG) — a hierarchical dual-view graph combining semantic features with structural metadata. The graph enables semantic search, dependency exploration, and agentic code navigation.
- **RPG-ZeroRepo** (Intent → Code): Generates repository code from high-level specifications using an RPG as the intermediate planning structure.

The core data structure is `G = (V, E)` where nodes carry `{ feature, metadata }` pairs (semantic description + code entity info) and edges represent either feature hierarchy (functional) or code dependencies (imports, calls, data flow).

## Entry Points

| Entry Point | File | Description |
|---|---|---|
| CLI | `packages/cli/src/cli.ts` | `soop` command — encode, evolve, search, fetch, explore, init, sync |
| MCP Server | `packages/mcp/src/server.ts` | JSON-RPC stdio server for Claude Code integration |
| Library API | `packages/soop/src/index.ts` | Published npm package (`@pleaseai/soop`) — re-exports all public APIs |
| Build | `tsdown.config.ts` | Produces library bundle + CLI binary into `packages/soop/dist/` |
| Tests | `vitest.config.ts` | Unit (`*.test.ts`) and integration (`*.integration.test.ts`) projects |
| Agent Evals | `evaluation/` | Agent evaluation framework using `@vercel/agent-eval` (soop vs baseline benchmarks) |

## Module Structure

```
packages/
├── ast/         Layer 0  tree-sitter parser (multi-language AST extraction, native via namu)
├── utils/       Layer 0  Git helpers, LLM client, logger, memory utilities
├── store/       Layer 0  Storage interfaces & implementations
├── graph/       Layer 1  RPG data structures (Node, Edge, RPG class)
├── encoder/     Layer 2  Code → RPG extraction pipeline
├── tools/       Layer 2  Agentic graph navigation (SearchNode, FetchNode, ExploreRPG)
├── zerorepo/    Layer 2  Intent → Code generation pipeline
├── namu/        Layer 2  native tree-sitter backend (@kreuzberg/tree-sitter-language-pack) + NamuNode adapter
├── mcp/         Layer 3  MCP server exposing tools as JSON-RPC
├── cli/         Layer 4  Commander-based CLI entry point
├── soop/        Publish  Umbrella package — bundles everything for npm
└── soop-native/ Publish  Native binary distribution (bun compiled)
```

### Top-Level Directories (outside `packages/`)

| Directory | Purpose |
|---|---|
| `evaluation/` | Agent evaluation framework (`@vercel/agent-eval`) — benchmarks soop-assisted vs baseline coding agents |
| `agent-evals/` | Evaluation experiment definitions and fixtures |
| `vendor/` | Read-only git submodule with Python reference implementation (`RPG-ZeroRepo`) |
| `docs/` | Research paper source files and implementation status |
| `tests/fixtures/` | Shared test fixtures (e.g., `superjson` submodule for evolution tests) |

### Layer 0: Foundation

**`@pleaseai/soop-ast`** — WASM-based tree-sitter parser supporting TypeScript, JavaScript, Python, Rust, Go, Java, Kotlin, Ruby, C, C++, C#. Extracts `CodeEntity` objects (classes, functions, interfaces) from source files.

**`@pleaseai/soop-utils`** — Shared utilities with sub-path exports:
- `@pleaseai/soop-utils/llm` — Multi-provider LLM client (Anthropic, OpenAI, Google via AI SDK; Claude Code, Codex CLI, and Gemini CLI as local providers)
- `@pleaseai/soop-utils/git-helpers` — Git operations (diff parsing, commit SHA, file listing)
- `@pleaseai/soop-utils/logger` — `consola`-based structured logging with tagged output
- `@pleaseai/soop-utils/memory` — Token-aware context management

**`@pleaseai/soop-store`** — Decomposed storage layer with three interface types:

| Interface | Implementations |
|---|---|
| `GraphStore` | `SQLiteGraphStore` (better-sqlite3, FTS5), `SurrealGraphStore` (embedded), `LocalGraphStore` (JSON) |
| `VectorStore` | `LocalVectorStore` (JSON, brute-force cosine), `LanceDBVectorStore` (optional) |
| `TextSearchStore` | `LocalTextSearchStore` (in-memory term-frequency), SQLite FTS5 |

Store implementations use sub-path exports (`@pleaseai/soop-store/sqlite`, `@pleaseai/soop-store/local`) to avoid transitive native module loading.

### Layer 1: Graph

**`@pleaseai/soop-graph`** — Core RPG data structures:
- `RepositoryPlanningGraph` — The central graph class managing nodes, edges, and backed by a `ContextStore`
- `HighLevelNode` / `LowLevelNode` — Architectural modules vs. atomic code entities
- `FunctionalEdge` / `DependencyEdge` / `DataFlowEdge` — Feature hierarchy, imports/calls, data flow
- Schema validation via Zod for all graph data

### Layer 2: Pipelines

**`@pleaseai/soop-encoder`** — The encoding pipeline:
1. **Semantic lifting** (`semantic.ts`) — LLM-based feature extraction from code entities
2. **Structural reorganization** (`reorganization/`) — Domain discovery + hierarchy building
3. **Artifact grounding** (`grounding.ts`) — Links nodes back to source locations
4. **Data flow detection** (`data-flow.ts`) — Cross-file data flow analysis
5. **Dependency injection** (`dependency-injection.ts`) — DI pattern detection
6. **Evolution** (`evolution/`) — Commit-level incremental updates (add/modify/delete)
7. **Semantic search** (`semantic-search.ts`) — Hybrid search (vector + FTS + string)
8. **Embedding** (`embedding.ts`, `embedding-manager.ts`) — Multi-provider embedding (Voyage AI, HuggingFace local, OpenAI)
9. **Caching** (`cache.ts`) — SQLite-based semantic response cache

**`@pleaseai/soop-tools`** — Agentic tools for graph navigation:
- `SearchNode` — Semantic search by feature terms or file patterns
- `FetchNode` — Retrieve entity details and source code
- `ExploreRPG` — Traverse functional and dependency edges

**`@pleaseai/soop-zerorepo`** — Code generation from specifications (three phases: proposal-level feature tree, implementation-level file/function design, code generation with test-driven validation).

### Layer 3–4: Interfaces

**`@pleaseai/soop-mcp`** — MCP server exposing six tools (`soop_search`, `soop_fetch`, `soop_explore`, `soop_encode`, `soop_evolve`, `soop_stats`) over JSON-RPC stdio transport.

**`@pleaseai/soop-cli`** — Commander-based CLI with commands: `encode`, `evolve`, `search`, `fetch`, `explore`, `embed`, `init`, `sync`, `stamp`, `last-commit`, `mcp`.

## Data Flow

```
Source Code
    │
    ▼
 AST Parser ──────► CodeEntity[]
    │
    ▼
 Semantic Extractor ──► SemanticFeature[] (LLM or heuristic)
    │
    ▼
 Reorganization ──────► HighLevelNode[] (domain grouping + hierarchy)
    │
    ▼
 Grounding ───────────► LowLevelNode[] (file/class/function → node mapping)
    │
    ▼
 Dependency Analysis ──► DependencyEdge[] + DataFlowEdge[] (AST-based)
    │
    ▼
 RPG (graph.json) ────► Searchable graph with semantic + structural views
    │
    ├──► MCP Server ──► Claude Code / AI agents
    ├──► CLI ──────────► Developer terminal
    └──► Evolution ────► Incremental updates from new commits
```

## Two-Tier Data Management

```
.soop/
  graph.json        ← Tier 1: CI-managed canonical RPG (git committed)
  config.json       ← Encode/sync settings (git committed)
  cache/            ← Semantic cache (gitignored)
  local/            ← Tier 2: Local-only data (gitignored)
    graph.json      ← Local evolved copy
    vectors/        ← Embedding indices
    state.json      ← Local state (base commit, branch)
```

**Tier 1 (CI)**: GitHub Actions runs `soop encode`/`soop evolve` on main push, commits `graph.json`.
**Tier 2 (Local)**: `soop sync` copies canonical graph, applies incremental evolve for branch changes, builds vector indices.

## Build & Distribution

The project uses **tsdown** (Rolldown-based) for bundling:

1. **Library bundle** → `packages/soop/dist/src/index.mjs` — all `@pleaseai/*` workspace packages bundled inline; native deps (`better-sqlite3`, `@kreuzberg/tree-sitter-language-pack`, `@lancedb/lancedb`) remain external
2. **CLI binary** → `packages/soop/dist/packages/cli/src/cli.mjs` — standalone CLI with all pure-JS deps bundled
3. **Native binary** → `packages/soop-native/` — Bun-compiled native binary distribution

Workspace packages are all `private: true` and never published individually — only `@pleaseai/soop` is published to npm. Publishing uses `bun pm pack` (auto-resolves `workspace:*` to real versions) + `npm publish <tarball>`.

## Architecture Invariants

- **Respect layer boundaries**: Layer N packages may only import from Layer ≤ N. Never import `cli` or `mcp` from library packages.
- **Store isolation**: Store implementations are NOT re-exported from the barrel index. Import via sub-paths (`@pleaseai/soop-store/sqlite`) to avoid loading native modules unnecessarily.
- **Cross-package imports use workspace names**: Always `@pleaseai/soop-graph`, never `../../graph/src`. Within-package imports use relative paths.
- **Zero-dependency defaults**: `LocalVectorStore` and `LocalGraphStore` (JSON-based) are the default storage. SQLite, SurrealDB, and LanceDB are opt-in backends.
- **RPG as concept name**: Class names preserve "RPG" (`RepositoryPlanningGraph`, `RPGEncoder`). Only brand/CLI/package names use "soop please".
- **No modifications to vendor/**: `vendor/RPG-ZeroRepo/` is a read-only git submodule containing the Python reference implementation.
- **English only**: All code, comments, commits, issues, and PR descriptions are in English.

## Testing

- **Vitest** with two workspace projects: `unit` (fast, `*.test.ts`) and `integration` (slow, `*.integration.test.ts`)
- Test files live in `packages/*/tests/`
- Integration tests use `tests/fixtures/superjson` submodule (real git history for evolution testing)
- Git-history-dependent tests guarded with `it.skipIf(!hasGitAncestor(...))`
- Run `bun run lint:fix` after editing test files (formatter/linter may disagree)

## Cross-Cutting Concerns

**Logging**: All packages use `consola` via `@pleaseai/soop-utils/logger`. Library packages call `createLogger('Tag')`, MCP server uses `createStderrLogger('Tag')` (stdout reserved for JSON-RPC). The `--verbose` CLI flag sets global log level to debug.

**LLM Integration**: Multi-provider support via AI SDK (`@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`) plus local providers (`claude-code`, `codex-cli`, `gemini-cli`). Semantic cache (SQLite WAL) avoids redundant LLM calls.

**Error Handling**: MCP server uses typed `RPGError` classes. Encoder operations are designed to be resumable — semantic cache preserves progress across interrupted runs.

**Configuration**: Repository-level config in `.soop/config.json`. CLI reads `.env.local` / `.env` for API keys. Workspace settings in `.please/config.yml`.
