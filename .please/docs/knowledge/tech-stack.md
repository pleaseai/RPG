# Tech Stack: soop please

## Runtime & Language

| Category | Technology | Version | Notes |
|----------|-----------|---------|-------|
| Runtime | Bun | 1.3.10 | Primary runtime and package manager |
| Language | TypeScript | 5.9 | Strict mode, ESM modules |

## Build & Development

| Category | Technology | Version | Notes |
|----------|-----------|---------|-------|
| Bundler | tsdown | 0.21 | Rolldown-based, bundles workspace packages inline |
| Monorepo | Bun workspaces + Turbo | 2.8 | Private root, multiple packages under `packages/` |
| Linter | ESLint | 10 | `@antfu/eslint-config` |
| Type check | tsc | 5.9 | `--noEmit` for validation |
| Git hooks | Husky | 9 | Pre-commit linting |

## Testing

| Category | Technology | Version | Notes |
|----------|-----------|---------|-------|
| Framework | Vitest | 4.x | Jest-compatible, workspace projects (unit/integration) |
| Coverage | @vitest/coverage-v8 | 4.x | V8-based coverage |

## Core Libraries

| Category | Technology | Notes |
|----------|-----------|-------|
| Schema | Zod 4 | Runtime validation for graph data |
| CLI | Commander 14 | CLI framework |
| Logging | consola | Structured logging with tags and levels |
| AST | tree-sitter (native) | `@kreuzberg/tree-sitter-language-pack` (NAPI, pinned `1.9.0-rc.10`) — prebuilt grammars, no emcc/Docker. Tuned extraction for TS, JS, Python, Rust, Go, Java, C#, C, C++, Ruby, Kotlin (300+ parseable). On-demand grammar cache (`SOOP_TS_CACHE_DIR`); no musl prebuild. |

## AI & LLM

| Category | Technology | Notes |
|----------|-----------|-------|
| AI SDK | Vercel AI SDK | Unified interface for LLM providers |
| Providers | Anthropic, OpenAI, Google | Via `@ai-sdk/*` adapters |
| Agent tools | claude-code, codex-cli | Via ai-sdk-provider adapters |
| Embedding | Voyage AI (API), @huggingface/transformers (local) | voyage-4 family, MongoDB LEAF models |

## Storage

| Category | Technology | Notes |
|----------|-----------|-------|
| Graph (default) | better-sqlite3 | WAL mode, FTS5 full-text search |
| Graph (alternative) | SurrealDB | Embedded graph DB (mem:// or surrealkv://) |
| Vector (default) | LocalVectorStore | Zero-dependency JSON, brute-force cosine |
| Vector (optional) | LanceDB | Disk-based, Bun-native vector DB |
| Text search (default) | LocalTextSearchStore | In-memory term-frequency matching |
