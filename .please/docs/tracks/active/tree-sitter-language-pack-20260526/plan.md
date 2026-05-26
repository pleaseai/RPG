# Plan: Migrate tree-sitter backend to native @kreuzberg/tree-sitter-language-pack

> Track: tree-sitter-language-pack-20260526
> Spec: [spec.md](./spec.md)

## Overview

- **Source**: /please:plan
- **Track**: tree-sitter-language-pack-20260526
- **Issue**: #{issue_number}
- **Created**: 2026-05-26
- **Approach**: Low-level backend swap behind the existing `NamuNode` interface, then full removal of the WASM build pipeline — sequenced spike-first to de-risk Bun NAPI loading.

## Purpose

Remove the emcc/Docker WASM build pipeline from `packages/namu` and unlock 300+
languages by adopting the native NAPI package `@kreuzberg/tree-sitter-language-pack`
(`1.9.0-rc.10`), while keeping `packages/ast`'s tuned extraction and all
`@pleaseai/soop-namu` consumers (`ast`, `encoder`) unchanged.

## Context

`@pleaseai/soop-namu` exposes `createParser()` / `getLanguage()` / `initNamu()` /
`isAvailable()` / `resolveWasmPath()` and the `NamuParser` / `NamuNode` / `NamuTree`
types. Consumers via the `NamuNode` interface: `packages/ast/src/parser.ts` and
`packages/encoder/src/{call-extractor,inheritance-extractor,type-inferrer}.ts`. The
adapter strategy means these consumers need no changes.

Blast radius of the dependency removal:
- `web-tree-sitter`: `packages/namu/{package.json,src/parser.ts,src/types.ts,build.ts}`,
  `packages/ast/src/parser.ts` (comment only), `packages/soop/package.json` (direct dep).
- 11 `tree-sitter-*` devDeps + `tree-sitter-cli` + `build:wasm`: `packages/namu`.
- `packages/namu/wasm/` + `resolveWasmPath` + `src/languages.ts` (WASM path resolver).

Distribution / runtime provisioning surfaces:
- `.github/workflows/soop-encode.yml` runs `soop encode` on `ubuntu-latest`
  (linux-x64-gnu) — parsers must be provisioned at runtime (cache + pre-download).
- `packages/soop-native` ships compiled binaries for 7 targets incl.
  **`linux-x64-musl` / `linux-arm64-musl`** — the native pack has **no musl prebuild**
  (open decision in T007).

## Architecture Decision

**Low-level swap + adapter, full replacement.** Wrap the native raw-AST API
(`getParser()` → `JsTree.rootNode` → `JsNode`) in `packages/namu`, exposing the
unchanged `NamuParser`/`NamuNode`/`NamuTree` shape through a `JsNode → NamuNode`
adapter. Rationale: preserves the tuned `LANGUAGE_CONFIGS` extraction in
`packages/ast` (highest-value, hardest-to-reproduce logic) and shields all consumers
behind a stable interface, so the change is contained to `packages/namu` + dependency
cleanup. The high-level `process()` API is rejected (would discard tuned mappings).

Sequenced **spike-first**: validate Bun can load the NAPI `.node` on both platforms
before investing in the rewrite, since that is the single highest risk.

## Architecture Diagram

```
packages/ast/parser.ts ─┐
encoder/*-extractor.ts ─┤ consume NamuNode interface (UNCHANGED)
                        ▼
            packages/namu  (REWRITTEN)
            ├─ getLanguage()/createParser() → native getParser()/getLanguage()
            ├─ JsNode ──[adapter]──▶ NamuNode  (kind()→.type, byteRange→.text, …)
            └─ cache config + pre-download (init/download)
                        ▼
   @kreuzberg/tree-sitter-language-pack@1.9.0-rc.10  (native .node, prebuilt)
                        ▼
   parser cache dir ◀── CI cache (soop-encode.yml) / single binary (soop-native)

   REMOVED: build.ts · web-tree-sitter · 11 tree-sitter-* · tree-sitter-cli · wasm/
```

## Tasks

- [x] T001 Spike: add `@kreuzberg/tree-sitter-language-pack@1.9.0-rc.10` to `packages/namu`, validate the NAPI `.node` loads under Bun 1.3.14 on darwin-x64 (local) and confirm linux-x64-gnu resolution; smoke-parse a TS snippet via `getParser('typescript')` and read `rootNode` (file: packages/namu/package.json) — **SC-2**, gate before T002
- [x] T002 Implement `JsNode → NamuNode` adapter and rewrite the namu backend on native `getParser()`/`getLanguage()` (map `kind()→.type`, `slice(startByte,endByte)→.text`, `childByFieldName→childForFieldName`, `startPosition()/endPosition()`, `parent()`, `previous/nextSibling`, `isError/isNamed/isMissing`, `toSexp()→toString()`); add cache-dir `configure()` + lazy `init()`; map `SupportedLanguage` → pack language names; keep `isAvailable()`/`createParser()`/`getLanguage()` exports (file: packages/namu/src/parser.ts) (depends on T001) — **SC-1, SC-5**
- [x] T003 [P] Rewrite `packages/namu/tests/parser.test.ts` for the native backend: drop `resolveWasmPath`/WASM-file-existence assertions; add adapter unit tests (positions, `.text`, field lookups, siblings, error flags) and parse smoke tests for the 11 languages (file: packages/namu/tests/parser.test.ts) (depends on T002)
- [x] T004 Validate behavior preservation: run the full `packages/ast` + `packages/encoder` suites against the native backend and fix any adapter drift until `ParseResult`/`CodeEntity` output for the 11 languages is equivalent (file: packages/namu/src/parser.ts) (depends on T002) — **SC-1**
- [x] T005 Remove the WASM pipeline: delete `build.ts`, the `build:wasm` script, `packages/namu/wasm/`, `resolveWasmPath`/`src/languages.ts` WASM bits; drop `web-tree-sitter` from `packages/namu` and `packages/soop`; drop the 11 `tree-sitter-*` devDeps + `tree-sitter-cli`; update `.gitignore` and the `web-tree-sitter` comment in `packages/ast/src/parser.ts` (file: packages/namu/package.json) (depends on T004) — **SC-3**
- [x] T006 Deterministic provisioning: configure a known parser cache dir and a pre-download step (`init()`/`download()` for the supported languages); add a parser-cache restore/save step to `.github/workflows/soop-encode.yml` mirroring the semantic-cache pattern (file: .github/workflows/soop-encode.yml) (depends on T002) — **SC-4**
- [x] T007 Resolve the distribution gap in `packages/soop-native`: verify the `.node` addon works under `bun build --compile` (follow the existing native-addon pattern, e.g. better-sqlite3); decide musl handling (drop `linux-*-musl` optional targets vs. document degraded AST parsing on musl) and apply it (file: packages/soop-native/package.json) (depends on T005, T006)
- [x] T008 Update docs: `CLAUDE.md` (Known Gotchas, tree-sitter rows, namu description) and `.please/docs/knowledge/tech-stack.md` — native backend, `1.9.0-rc.10` pin + prerelease caveat, parser-cache model, dropped emcc/Docker, platform matrix incl. musl caveat (file: CLAUDE.md) (depends on T005, T006, T007)

## Dependencies

```
T001 ─▶ T002 ─┬─▶ T003 [P]
              ├─▶ T004 ─▶ T005 ─┐
              └─▶ T006 ─────────┴─▶ T007 ─▶ T008
```

## Key Files

| File | Role in this track |
|------|--------------------|
| `packages/namu/src/parser.ts` | Rewritten: native backend + adapter (core change) |
| `packages/namu/src/types.ts` | `NamuNode`/`SupportedLanguage` — interface preserved |
| `packages/namu/src/languages.ts` | WASM path resolver — removed/repurposed to language-name map |
| `packages/namu/build.ts` | Removed |
| `packages/namu/package.json` | Swap deps: add pack, drop web-tree-sitter + 11 grammars + cli |
| `packages/namu/tests/parser.test.ts` | Rewritten for native backend |
| `packages/ast/src/parser.ts` | Consumer — unchanged except a comment |
| `packages/encoder/src/{call,inheritance,type}-*.ts` | Consumers — unchanged |
| `packages/soop/package.json` | Drop direct `web-tree-sitter` dep |
| `packages/soop-native/package.json` | musl/compiled-binary distribution decision |
| `.github/workflows/soop-encode.yml` | Parser cache + pre-download |

## Verification

- `bun run test packages/namu` — native backend + adapter unit tests pass.
- `bun run test packages/ast packages/encoder` — behavior preserved (SC-1).
- Fresh checkout: `bun install && bun run test` with no emcc/Docker, no `build:wasm` (SC-3).
- `bun run typecheck` and `bun run lint` clean.
- Manual: confirm `getParser` loads on darwin-x64 (local) and CI `soop encode` succeeds
  on linux-x64-gnu with the parser cache (SC-2, SC-4).

## Progress

- **2026-05-26 — T001 (spike) complete.** Validated `@kreuzberg/tree-sitter-language-pack@1.9.0-rc.10`
  loads under Bun 1.3.14 on darwin-x64 and parses TypeScript. SC-2 (darwin-x64) confirmed;
  linux-x64-gnu binary bundled for CI.
- **2026-05-26 — T002/T003 complete.** Native backend + `JsNode→NamuNode` adapter in
  `packages/namu`; 31 namu tests (incl. adapter edges) pass.
- **2026-05-26 — T004 complete (SC-1).** Behavior preserved: 169 `ast` + 98 encoder
  parser-consumer tests (call/inheritance/type extractors) pass on the native backend.
  6 `semantic-retry.test.ts` failures are **pre-existing and unrelated** — they throw in
  `SemanticExtractor` (`semantic.ts:168`) because `GOOGLE_GENERATIVE_AI_API_KEY` is unset
  locally; that test imports no parser code.
- **2026-05-26 — T005 complete (SC-3).** Removed `build.ts`, `wasm/`, `build:wasm`,
  `web-tree-sitter`, 11 grammars + `tree-sitter-cli`; soop dep + tsdown external swapped to
  the native pack; root `build:copy-assets` no longer builds/copies WASM. 200 tests pass.
- **2026-05-26 — T006 complete (SC-4).** `SOOP_TS_CACHE_DIR` pins the grammar cache;
  `prefetchLanguages()` helper added; `soop-encode.yml` caches `.soop/cache/tree-sitter`.
- **2026-05-26 — T007 complete.** Native pack externalized from compiled binaries
  (parity with prior web-tree-sitter); musl targets kept + limitation documented.
- **2026-05-26 — T008 complete.** CLAUDE.md (namu/ast rows, tree-sitter lib, new gotcha)
  and tech-stack.md updated for the native backend, pin, cache model, and platform matrix.

## Decision Log

- **Native NAPI over WASM variant** — chosen for 300+ language coverage (user decision).
- **Pin `1.9.0-rc.10`** — only release line shipping the `darwin-x64` prebuild required
  by the Intel-Mac dev environment (upstream #127); revisit to stable post-1.9.0.
- **Adapter over `process()`** — preserve tuned `LANGUAGE_CONFIGS` extraction and keep
  consumers untouched.
- **RESOLVED (T007): musl distribution** — keep the musl targets. The compiled binaries
  externalize the native pack (parity with the prior `web-tree-sitter` handling), so they
  still build from a single runner; the parser is resolved at runtime from the host's npm
  install. Since the pack ships no musl prebuild, AST parsing on a musl host needs glibc —
  documented rather than dropping a published platform (reversible once musl prebuilds land).

## Surprises & Discoveries

- **Native `Node` has no `previousSibling`/`nextSibling`** — the adapter must compute
  siblings from `parent()`'s child list + index. `parser.ts` relies on `previousSibling`
  for doc-comment extraction.
- **No `.text` accessor** — adapter slices `source.slice(startByte(), endByte())`, so the
  source string must be threaded into every adapted node.
- **Binaries are bundled inside the main package** (`ts-pack-core-node.<triple>.node`),
  not split into per-platform optional-dep packages — simplifies resolution.
- **`languageCount()` is 0 until a language is used** (lazy registration); `hasLanguage()`
  and parsing work regardless.
- **Native dep reintroduces a tension with the cross-compile distribution model.** The
  prior WASM migration's stated rationale was "eliminate native deps so one runner can
  cross-compile all 7 targets". The native pack is platform-specific, so it is externalized
  from the compiled binaries (same posture as `web-tree-sitter` before) and resolved via
  the host npm install. The npm-install path (`bun install -g @pleaseai/soop`, used by the
  encode CI) is the fully-supported channel and is validated; the compiled-binary channel
  treats the parser as external exactly as before — no new regression.
- **Grammars are downloaded on demand + cached** at `~/.cache|Library/Caches/
  tree-sitter-language-pack/v<ver>/libs`; `SOOP_TS_CACHE_DIR` pins it for CI/offline.
