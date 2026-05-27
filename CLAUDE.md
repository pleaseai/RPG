# CLAUDE.md

@.please/INDEX.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**soop please** is a TypeScript/Bun implementation of two research papers:
- **RPG-ZeroRepo**: Repository generation from specifications (Intent → Code)
- **RPG-Encoder**: Repository understanding via graph encoding (Code → Intent)

The core data structure is the **Repository Planning Graph (RPG)** - a hierarchical dual-view graph combining semantic features with structural metadata.

> Note: "RPG" (Repository Planning Graph) as a concept name is preserved in class names (`RepositoryPlanningGraph`, `RPGEncoder`, etc.). Only the brand/CLI/package names have changed to "soop please" / `repo` / `@pleaseai/soop`.

## Build & Development Commands

```bash
# Install dependencies
bun install

# Run in development mode (with watch)
bun run dev

# Build for production
bun run build

# Run all tests
bun run test

# Run unit tests only
bun run test:unit

# Run integration tests only
bun run test:integration

# Run single test file
bun run test packages/graph/tests/graph.test.ts

# Run specific test by name
bun run test -t "should create node"

# Watch mode for tests
bun run test:watch

# Test UI (browser-based)
bun run test:ui

# Test with coverage
bun run test:coverage

# Lint
bun run lint

# Lint and auto-fix
bun run lint:fix

# Format code
bun run format

# Type checking
bun run typecheck

# CLI (development)
bun run packages/cli/src/cli.ts encode ./my_project

# Initialize soop please in a repository
soop init [path] [--hooks] [--ci] [--encode]

# Sync canonical graph to local with incremental evolve
soop sync [--force]

# Stamp config.github.commit with current HEAD SHA
soop stamp <repo-file>

# Print last encoded commit SHA
soop last-commit <repo-file>
```

## Two-Tier RPG Data Management

soop please uses a two-tier architecture for data management:

**Tier 1 (CI)**: On main push, `soop encode`/`soop evolve` runs in GitHub Actions and commits `.soop/graph.json` to git.

**Tier 2 (Local)**: `soop sync` copies the canonical graph to `.soop/local/`, applies incremental evolve for local branch changes, and builds vector indices. Local data is gitignored.

```
.soop/
  graph.json          # Canonical RPG (git committed, CI-managed)
  config.json         # Encode/sync settings (git committed)
  cache/              # Semantic cache (gitignored)
    semantic-cache.db # LLM response cache (SQLite, WAL mode)
  local/              # Local-only data (gitignored)
    graph.json        # Local evolved RPG copy
    vectors/          # Local vector embeddings (LocalVectorStore, JSON-based)
    state.json        # Local state (base commit, branch, etc.)
```

### Setup

```bash
# Initialize with CI workflow and git hooks
soop init --ci --hooks --encode

# Or step by step:
soop init                      # Create .soop/ structure
soop encode . -o .soop/graph.json  # Initial encode (auto-stamps HEAD SHA)
soop sync                      # Copy to local + evolve
```

### Commit tracking

`encoder.save()` automatically records the HEAD SHA in `config.github.commit`. The CI workflow uses `soop last-commit` to determine the commit range for incremental evolve.

## Architecture

### Workspace Structure

The project uses **Bun workspaces** with a private monorepo root (`version: 0.0.0`) and 12 packages under `packages/`. Published outputs are `packages/soop` (`@pleaseai/soop`) and `packages/soop-native`; other workspace packages are `private: true` and bundled inline.

```
packages/
├── soop/        # Published: @pleaseai/soop (umbrella package, bin/soop)
├── soop-native/ # Published: native binary distribution (bun compiled)
├── ast/         # Layer 0: tree-sitter parser (native, via namu) — @pleaseai/soop-ast
├── utils/       # Layer 0: LLM interface, git helpers, logger (independent)
├── store/       # Layer 0: Storage interfaces & implementations (independent)
├── graph/       # Layer 1: RPG data structures (→ store)
├── encoder/     # Layer 2: Code → RPG extraction (→ graph, utils, ast)
├── tools/       # Layer 2: Agentic tools for graph navigation (→ graph, encoder)
├── zerorepo/    # Layer 2: Intent → Code generation (→ graph, utils)
├── namu/        # Layer 2: native tree-sitter backend (@kreuzberg/tree-sitter-language-pack) + NamuNode adapter
├── mcp/         # Layer 3: MCP server (→ graph, encoder, tools, utils)
└── cli/         # Layer 4: CLI entry point (→ encoder, graph, tools, zerorepo)
```

### Import Pattern

Cross-package imports use workspace package names:
```typescript
// Correct: workspace package imports
import { RepositoryPlanningGraph } from '@pleaseai/soop-graph'
import { ASTParser } from '@pleaseai/soop-ast'
import { RPGEncoder } from '@pleaseai/soop-encoder'

// Sub-path exports are available for fine-grained imports:
import { SQLiteGraphStore } from '@pleaseai/soop-store/sqlite'
import { DataFlowEdgeSchema } from '@pleaseai/soop-graph/edge'
import { SemanticSearch } from '@pleaseai/soop-encoder/semantic-search'
```

Within the same package, use relative imports:
```typescript
// Inside packages/encoder/src/encoder.ts:
import { SemanticCache } from './cache'
import { DataFlowDetector } from './data-flow'
```

### Core Concepts

**RPG Graph Structure** `G = (V, E)`:
- **Nodes (V)**: Each node contains `{ feature, metadata }` where feature = semantic description, metadata = code entity info
  - `HighLevelNode`: Architectural directories/modules
  - `LowLevelNode`: Atomic implementations (files, classes, functions)
- **Edges (E)**:
  - `FunctionalEdge`: Feature hierarchy (parent-child relationships)
  - `DependencyEdge`: Import/call relationships via AST analysis

### Module Responsibilities

| Package | Purpose |
|---------|---------|
| `@pleaseai/soop-utils` | AST parser (tree-sitter), LLM interface (OpenAI/Anthropic/Google/Gemini CLI), git helpers, logger |
| `@pleaseai/soop-store` | Storage interfaces (GraphStore, VectorStore, TextSearchStore) & implementations (SQLite, SurrealDB, LanceDB) |
| `@pleaseai/soop-graph` | RPG data structures (Node, Edge, RPG class) |
| `@pleaseai/soop-encoder` | Code → RPG extraction (semantic lifting, structural reorganization, artifact grounding, evolution) |
| `@pleaseai/soop-tools` | Agentic tools (SearchNode, FetchNode, ExploreRPG) for graph navigation |
| `@pleaseai/soop-zerorepo` | Intent → Code generation (proposal construction, implementation planning, code generation) |
| `@pleaseai/soop-mcp` | MCP server for Claude Code integration |
| `@pleaseai/soop-cli` | CLI entry point |

### Key Pipelines

**ZeroRepo (Generation)**:
1. Proposal-level: Feature tree → explore-exploit selection → goal-aligned refactoring
2. Implementation-level: File structure → data flow → interface design
3. Code generation: Topological traversal with test-driven validation

**Encoder (Understanding)**:
1. Encoding: Semantic lifting → structural reorganization → artifact grounding
2. Evolution: Commit-level incremental updates (add/modify/delete)
3. Operation: SearchNode, FetchNode, ExploreRPG tools

### Store Implementations

The `@pleaseai/soop-store` package provides the storage layer with decomposed interfaces:

| Store | Module | Engine | Search |
|-------|--------|--------|--------|
| `SQLiteGraphStore` | `packages/store/src/sqlite/` | `better-sqlite3` (WAL mode) | FTS5 full-text search |
| `SurrealGraphStore` | `packages/store/src/surreal/` | `surrealdb` + `@surrealdb/node` embedded | BM25 search |
| `LanceDBVectorStore` | `packages/store/src/lancedb/` | LanceDB (optional) | Vector similarity search |
| `LocalVectorStore` | `packages/store/src/local/` | JSON file (zero-dependency) | Brute-force cosine similarity |
| `LocalGraphStore` | `packages/store/src/local/` | JSON file (zero-dependency) | — (SQLite fallback) |
| `LocalTextSearchStore` | `packages/store/src/local/` | In-memory (zero-dependency) | Term-frequency word matching |
| `DefaultContextStore` | `packages/store/src/default-context-store.ts` | SQLite + LocalVectorStore (LocalGraph fallback) | Graph + Text + Vector |

**Import pattern** — store implementations are NOT re-exported from the barrel to avoid transitive native module loading:
```typescript
import { SQLiteGraphStore } from '@pleaseai/soop-store/sqlite'
import { SurrealGraphStore } from '@pleaseai/soop-store/surreal'
import { LocalVectorStore, LocalGraphStore, LocalTextSearchStore } from '@pleaseai/soop-store/local' // zero-dependency defaults
import { LanceDBVectorStore } from '@pleaseai/soop-store/lancedb' // optional, requires @lancedb/lancedb
import { DefaultContextStore } from '@pleaseai/soop-store/default-context-store'
```

### Key Libraries

- **tree-sitter** (native, via `@kreuzberg/tree-sitter-language-pack`): AST parsing for multiple languages (TypeScript, JavaScript, Python, Rust, Go, Java, C#, C, C++, Ruby, Kotlin — 300+ available). Prebuilt NAPI binaries, no emcc/Docker build. `packages/namu` wraps it behind the `NamuNode` interface via an adapter.
- **lancedb**: Vector DB for semantic search (Bun-native, disk-based) — optional dependency; `LocalVectorStore` is used as the zero-dependency fallback
- **surrealdb** + **@surrealdb/node**: Embedded graph database (mem:// or surrealkv://)
- **@huggingface/transformers**: Local embedding with MongoDB LEAF models
- **zod**: Schema validation for graph data
- **commander**: CLI framework
- **consola**: Structured logging with log levels and tagged output
- **vitest**: Testing framework (Jest-compatible, for MCP compatibility)

## Reference Implementation

`vendor/RPG-ZeroRepo/` contains the **official Python reference implementation** by the paper authors (MIT license). It is tracked as a git submodule and kept read-only — do not modify it.

### What it is

- Language: Python 3.11+
- Entry point: `main.py` → `zerorepo/` package
- Config: `configs/zerorepo_config.yaml` (LLM provider, Docker, trae-agent settings)
- Pipeline (3 phases):
  1. **Property Level** (`zerorepo/rpg_gen/prop_level/`) — `FeatureSelectAgent` + `FeatureRefactorAgent` → feature tree → components
  2. **Implementation Level** (`zerorepo/rpg_gen/impl_level/`) — `FileDesigner` + `FuncDesigner` + `TaskPlanner` → RPG graph + task batches
  3. **Code Generation** (`zerorepo/code_gen/`) — `IterativeCodeGenerator` runs `trae-agent` inside Docker with TDD loop (test → implement → run → fix)

### How our TypeScript implementation relates

| Aspect | Reference (Python) | This project (TypeScript/Bun) |
|--------|-------------------|-------------------------------|
| ZeroRepo pipeline | `zerorepo/` | `packages/zerorepo/` |
| RPG graph | `checkpoints/global_repo_rpg.json` | `packages/graph/` (`RepositoryPlanningGraph`) |
| Encoder | Not yet open-sourced | `packages/encoder/` |
| Storage | JSON checkpoints | `packages/store/` (SQLite, SurrealDB, LanceDB) |
| Code gen agent | `trae-agent` (Docker) | Planned (Claude Code / Codex CLI) |

When implementing new features, **always check the reference implementation first** for algorithm details, intermediate file schemas, and agent prompt designs.

## Reference Papers

- RPG-ZeroRepo: https://arxiv.org/abs/2509.16198
- RPG-Encoder: https://arxiv.org/abs/2602.02084
- Paper source files in `docs/arXiv-*/` for implementation details
- **Paper vs Implementation Status**: [docs/implementation-status.md](docs/implementation-status.md)

## MCP Server

soop please provides an MCP (Model Context Protocol) server for Claude Code integration.

### Running the MCP Server

```bash
# Development mode
bun run mcp <repo-file.json>

# Example with sample fixture
bun run mcp tests/fixtures/sample-rpg.json
```

### Available MCP Tools

| Tool | Description |
|------|-------------|
| `soop_search` | Semantic code search by features or file patterns |
| `soop_fetch` | Retrieve entity details, source code, and feature paths |
| `soop_explore` | Traverse the graph along functional/dependency edges |
| `soop_encode` | Convert a repository into an RPG |
| `soop_evolve` | Incrementally update the RPG with new commits |
| `soop_stats` | Get graph statistics (node/edge counts) |

### When to Use soop MCP Tools

Use soop MCP tools **before** reading files with Read/Grep when you need to understand code semantics, architecture, or find related code across the codebase. The RPG graph provides semantic understanding that text search cannot.

**Prefer soop MCP when:**
- Finding code by behavior/purpose (not filename): `soop_search` with `featureTerms`
- Understanding what a class/function does and its role: `soop_fetch` with entity ID
- Exploring dependencies and relationships: `soop_explore`
- Getting codebase overview/statistics: `soop_stats`

**Prefer Read/Grep/Glob when:**
- You already know the exact file path
- Searching for literal strings, variable names, or error messages
- Reading specific line ranges

### soop MCP Tool Usage

**`soop_search`** — Semantic code search (start here for discovery)
- Feature search: `featureTerms: ["authentication", "JWT validation"]` — find code by behavior
- File pattern: `filePattern: "*.test.ts"`, `mode: "snippets"` — find by file pattern
- Auto mode (default): tries feature search first, falls back to snippets
- `searchScopes`: restrict to subtree by node ID (e.g., `["packages/encoder"]`)
- `searchStrategy`: `hybrid` (default), `vector`, `fts`, `string`

**`soop_fetch`** — Get entity details and source code
- `codeEntities: ["packages/encoder/src/encoder.ts:class:RPGEncoder:510"]` — by node ID from search results
- `featureEntities: ["domain:encoding"]` — by feature/high-level node ID
- Returns: node metadata, full source code, feature paths in hierarchy

**`soop_explore`** — Traverse graph relationships
- Navigate functional edges (parent-child) and dependency edges (imports/calls)
- Use after `soop_fetch` to understand how entities connect

**`soop_encode`** — Encode a repository into RPG (heavy operation, use sparingly)

**`soop_evolve`** — Incrementally update RPG with new commits

**`soop_stats`** — Quick graph overview (node/edge counts, structure summary)

### Claude Code Configuration

Add to your Claude Code settings (`.claude/settings.json` or `~/.config/claude/settings.json`):

```json
{
  "mcpServers": {
    "soop": {
      "command": "bun",
      "args": ["run", "/path/to/soop/packages/mcp/src/server.ts", "/path/to/graph-file.json"],
      "env": {}
    }
  }
}
```

Or with the installed package:

```json
{
  "mcpServers": {
    "soop": {
      "command": "soop",
      "args": ["mcp", "/path/to/graph-file.json"]
    }
  }
}
```

## Language Convention

All git commit messages, code comments, GitHub issues, pull request titles/descriptions, and review comments must be written in **English**.

## Design Decisions

- **Bun workspaces**: Monorepo with private root (`version: 0.0.0`) and `packages/soop` as the published umbrella package; all `@pleaseai/soop-*` workspace packages are `private: true`
- **Vitest over Bun Test**: Jest compatibility for planned MCP server development
- **LanceDB over ChromaDB**: No external server required, Bun-native, disk-based persistence — available as an optional high-performance vector store via `@pleaseai/soop-store/lancedb`; `LocalVectorStore` (zero-dependency JSON store) is the current default everywhere, with LanceDB as an opt-in upgrade
- **All workspace packages bundled inline**: `@pleaseai/soop-*` are all `private: true` and not published to npm; tsdown `noExternal` bundles them into the CLI/library outputs so `npm install -g @pleaseai/soop` works without 404 errors
- **Paper-based implementation**: Original implementation based on research papers, not forked from Microsoft code
- **Dual GraphStore backends**: SQLiteGraphStore (better-sqlite3) and SurrealGraphStore (native graph relations) in `@pleaseai/soop-store` for evaluation

## Logging

The project uses [`consola`](https://github.com/unjs/consola) for structured logging via `@pleaseai/soop-utils/logger`.

### Usage

```typescript
// In library packages — use createLogger with a tag
import { createLogger } from '@pleaseai/soop-utils/logger'
const log = createLogger('MyModule')
log.info('Processing...')       // [MyModule] Processing...
log.warn('Fallback used')       // [MyModule] Fallback used
log.error('Operation failed')   // [MyModule] Operation failed
log.debug('Verbose details')    // Hidden unless log level >= 4

// In MCP server — use createStderrLogger (stdout reserved for JSON-RPC)
import { createStderrLogger } from '@pleaseai/soop-utils/logger'
const log = createStderrLogger('MCP')

// Set global log level (affects all loggers: createLogger children + createStderrLogger instances)
import { setLogLevel, LogLevels } from '@pleaseai/soop-utils/logger'
setLogLevel(LogLevels.debug)    // Enable debug output
```

### Log Levels

| Level | Value | Methods |
|-------|-------|---------|
| Fatal | 0 | `log.fatal()` |
| Error | 0 | `log.error()` |
| Warn | 1 | `log.warn()` |
| Log | 2 | `log.log()` |
| Info | 3 | `log.info()`, `log.success()`, `log.fail()`, `log.ready()`, `log.start()`, `log.box()` |
| Debug | 4 | `log.debug()` |
| Trace | 5 | `log.trace()` |

### CLI `--verbose` Flag

The CLI `encode` command accepts `--verbose` which sets the global log level to `debug` (4), making `log.debug()` calls visible across all packages (both `createLogger` and `createStderrLogger` instances).

### Logging vs Output in CLI

- **Logging** (use consola): progress info, phase transitions, verbose details
- **Output** (keep `console.log`): user-facing results, statistics, search results

## Known Gotchas

### tree-sitter native language pack (`@pleaseai/soop-namu`)
- **Version pinned to `1.9.0-rc.10`** (a prerelease, the `next` dist-tag). This is intentional: the `darwin-x64` (Intel Mac) prebuild ships **only** on the rc line (upstream [#127](https://github.com/kreuzberg-dev/tree-sitter-language-pack/issues/127)); stable `1.8.1` has no Intel Mac binary. Move to a stable `>=1.9.0` once published.
- **Prebuild platforms**: `darwin-x64/arm64`, `linux-x64/arm64-gnu`, `win-x64/arm64`. **No musl prebuild** — AST parsing on Alpine/musl hosts is unsupported (`@pleaseai/soop-native` musl binaries still build, but the parser must be resolved on a glibc host via `bun install -g @pleaseai/soop`).
- **On-demand grammar download + cache**: grammars are fetched on first use and cached under `~/.cache|Library/Caches/tree-sitter-language-pack/v<version>/libs`. Set `SOOP_TS_CACHE_DIR` to pin the cache to a known/cacheable path (used by `soop-encode.yml` CI).
- **`NamuNode` adapter**: `packages/namu/src/adapter.ts` bridges the native method-based `Node` (`kind()`, `startByte()`, `childByFieldName()`) to the property-based `NamuNode` interface. The native node has no `.text` (sliced from source by byte offset) and no sibling accessors (computed from parent + index).

### better-sqlite3 native bindings
If `better-sqlite3` native bindings are compiled for a different Node.js version, run `npm rebuild better-sqlite3` to recompile them.

### SurrealDB embedded engine limitations
- **No transactions**: `mem://` and `surrealkv://` engines do not support `beginTransaction()`. Use sequential operations instead.
- **option\<T\> fields**: SCHEMAFULL tables with `option<T>` fields reject JS `null`. Omit the field entirely from the content object.
- **ORDER BY**: Fields used in `ORDER BY` must also appear in the `SELECT` clause.
- **No LIKE operator**: Use application-level regex filtering instead.
- **update().patch()**: Expects RFC 6902 JSON Patch operations, not plain objects. Use `UPDATE SET` queries for partial updates.
- **SDK imports**: Use `createNodeEngines` from `@surrealdb/node` and `RecordId`, `Table`, `Surreal` from `surrealdb`.

### Vitest CLI
- `--include` is not a valid CLI option; use positional arguments (`vitest run 'pattern'`) or workspace projects (`--project=unit`)
- Test file naming: `*.integration.test.ts` for integration tests, `*.test.ts` for unit tests
- Test files live in `packages/*/tests/` — run a single package's tests with e.g. `bun run test packages/encoder/tests/semantic.test.ts`

### CI shallow clones
- `actions/checkout` (v4/v6 depending on workflow) defaults to `fetch-depth: 1` — tests using `HEAD~1..HEAD` or specific commit hashes will fail
- Unit tests use `fetch-depth: 2`; integration tests use `fetch-depth: 0` (full history for submodule fixture commits)
- Guard git-history-dependent tests with `it.skipIf(!hasGitAncestor(repoPath, ref))` as a safety net
- The `tests/fixtures/superjson` submodule is a real git repository used for evolution/diff-parser integration tests

### packages/soop workspace dependencies
- Always declare `@pleaseai/soop-*` workspace packages in `devDependencies` of `packages/soop/package.json`, **not** `dependencies` — they are `private: true` and not published to npm, so listing them in `dependencies` causes `npm install -g @pleaseai/soop` to fail with 404 errors
- The `release-please` `node-workspace` plugin detects both `dependencies` **and** `devDependencies` for cascade version bumps, so `devDependencies` is sufficient
- Publishing uses `bun pm pack` + `npm publish <tarball>` — `bun pm pack` automatically resolves `workspace:*` to real versions in the tarball, so no `prepack`/`postpack` hacks are needed

### Husky hook warnings
- Switching branches or committing may produce non-blocking warnings: `eval: [[: not found` and `soop sync failed (exit 1)` — these come from `.husky/_/` scripts and can be ignored; the git operation completes successfully

### Submodule dirty state
- `tests/fixtures/superjson` and `vendor/RPG-ZeroRepo` submodules frequently appear as `modified` in `git status` — do not stage or commit them unless intentionally updating a submodule

### Linter auto-formatting
- Always run `bun run lint:fix` after editing test files — the local formatter and CI linter may disagree on arrow-parens, brace-style, and comma-dangle

## Semantic Extraction

RPG encoding uses LLM for semantic feature extraction. Options:

| Mode | Performance | Cost | Use Case |
|------|-------------|------|----------|
| `useLLM: true` + Gemini 3.1 Flash-Lite (`gemini-3.1-flash-lite-preview`) | Best | $0.25/$1.50 per 1M | **Recommended default** |
| `useLLM: true` + Claude Haiku 4.5 | High (73% SWE-bench) | $1/$5 per 1M | Production fallback |
| `useLLM: true` + GPT-4o | High (70% SWE-bench) | $3/$10 per 1M | Paper baseline |
| `useLLM: true` + Claude Code (sonnet) | High | Pro/Max sub | No API key needed |
| `useLLM: true` + Codex CLI (gpt-5.3-codex) | High | Plus/Pro sub | No API key needed |
| `useLLM: true` + Gemini CLI (`gemini-cli`) | High | Free (OAuth) | Local dev with `gemini` CLI login |
| `useLLM: false` (heuristic) | ~15% lower | Free | Offline/testing |

## Embedding Options

CLI flag: `--embed-model <provider/model>` (encode/embed commands)

| Provider | Model | CLI prefix | Dimension | Cost | Notes |
|----------|-------|-----------|-----------|------|-------|
| Voyage AI | voyage-4 | `voyage-ai/voyage-4` | 1024 | $0.06/1M | **Default (CI)** — balanced quality/cost |
| Voyage AI | voyage-4-large | `voyage-ai/voyage-4-large` | 1024 | $0.12/1M | Best quality, MoE architecture |
| Voyage AI | voyage-4-lite | `voyage-ai/voyage-4-lite` | 1024 | $0.02/1M | Low latency, query-time use |
| HuggingFace (local) | voyageai/voyage-4-nano | `transformers/voyageai/voyage-4-nano` | 1024 | Free | **Default (local)** — open-weight, Apache 2.0 |
| HuggingFace (local) | MongoDB/mdbr-leaf-ir | `transformers/MongoDB/mdbr-leaf-ir` | 768 | Free | Information retrieval |
| HuggingFace (local) | MongoDB/mdbr-leaf-mt | `transformers/MongoDB/mdbr-leaf-mt` | 1024 | Free | Multi-task |
| OpenAI | text-embedding-3-small | `openai/text-embedding-3-small` | 1536 | $0.02/1M | |
| OpenAI | text-embedding-3-large | `openai/text-embedding-3-large` | 3072 | $0.13/1M | |

All Voyage 4 models (including local `voyage-4-nano`) share the same embedding space — documents and queries can use different models interchangeably.

### CI Workflow Model Selection

The `soop init --ci` template automatically selects the embedding model:

- `VOYAGE_API_KEY` set → `voyage-ai/voyage-4`
- `VOYAGE_API_KEY` not set → `transformers/voyageai/voyage-4-nano` (free, no API key required)

### Alternative Embedding Models (Not Yet Implemented)

| Provider | Model | Dimension | Cost | Notes |
|----------|-------|-----------|------|-------|
| Google | gemini-embedding-001 | 3072 | Free | MTEB Multilingual #1 |
| Jina AI | jina-embeddings-v3 | 1024 | $0.02/1M | Paper baseline (Agentless) |
