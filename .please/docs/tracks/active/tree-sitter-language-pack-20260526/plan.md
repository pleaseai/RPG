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

- [ ] T001 Spike: add `@kreuzberg/tree-sitter-language-pack@1.9.0-rc.10` to `packages/namu`, validate the NAPI `.node` loads under Bun 1.3.14 on darwin-x64 (local) and confirm linux-x64-gnu resolution; smoke-parse a TS snippet via `getParser('typescript')` and read `rootNode` (file: packages/namu/package.json) — **SC-2**, gate before T002
- [ ] T002 Implement `JsNode → NamuNode` adapter and rewrite the namu backend on native `getParser()`/`getLanguage()` (map `kind()→.type`, `slice(startByte,endByte)→.text`, `childByFieldName→childForFieldName`, `startPosition()/endPosition()`, `parent()`, `previous/nextSibling`, `isError/isNamed/isMissing`, `toSexp()→toString()`); add cache-dir `configure()` + lazy `init()`; map `SupportedLanguage` → pack language names; keep `isAvailable()`/`createParser()`/`getLanguage()` exports (file: packages/namu/src/parser.ts) (depends on T001) — **SC-1, SC-5**
- [ ] T003 [P] Rewrite `packages/namu/tests/parser.test.ts` for the native backend: drop `resolveWasmPath`/WASM-file-existence assertions; add adapter unit tests (positions, `.text`, field lookups, siblings, error flags) and parse smoke tests for the 11 languages (file: packages/namu/tests/parser.test.ts) (depends on T002)
- [ ] T004 Validate behavior preservation: run the full `packages/ast` + `packages/encoder` suites against the native backend and fix any adapter drift until `ParseResult`/`CodeEntity` output for the 11 languages is equivalent (file: packages/namu/src/parser.ts) (depends on T002) — **SC-1**
- [ ] T005 Remove the WASM pipeline: delete `build.ts`, the `build:wasm` script, `packages/namu/wasm/`, `resolveWasmPath`/`src/languages.ts` WASM bits; drop `web-tree-sitter` from `packages/namu` and `packages/soop`; drop the 11 `tree-sitter-*` devDeps + `tree-sitter-cli`; update `.gitignore` and the `web-tree-sitter` comment in `packages/ast/src/parser.ts` (file: packages/namu/package.json) (depends on T004) — **SC-3**
- [ ] T006 Deterministic provisioning: configure a known parser cache dir and a pre-download step (`init()`/`download()` for the supported languages); add a parser-cache restore/save step to `.github/workflows/soop-encode.yml` mirroring the semantic-cache pattern (file: .github/workflows/soop-encode.yml) (depends on T002) — **SC-4**
- [ ] T007 Resolve the distribution gap in `packages/soop-native`: verify the `.node` addon works under `bun build --compile` (follow the existing native-addon pattern, e.g. better-sqlite3); decide musl handling (drop `linux-*-musl` optional targets vs. document degraded AST parsing on musl) and apply it (file: packages/soop-native/package.json) (depends on T005, T006)
- [ ] T008 Update docs: `CLAUDE.md` (Known Gotchas, tree-sitter rows, namu description) and `.please/docs/knowledge/tech-stack.md` — native backend, `1.9.0-rc.10` pin + prerelease caveat, parser-cache model, dropped emcc/Docker, platform matrix incl. musl caveat (file: CLAUDE.md) (depends on T005, T006, T007)

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

_(updated by /please:implement)_

## Decision Log

- **Native NAPI over WASM variant** — chosen for 300+ language coverage (user decision).
- **Pin `1.9.0-rc.10`** — only release line shipping the `darwin-x64` prebuild required
  by the Intel-Mac dev environment (upstream #127); revisit to stable post-1.9.0.
- **Adapter over `process()`** — preserve tuned `LANGUAGE_CONFIGS` extraction and keep
  consumers untouched.
- **OPEN (T007): musl distribution** — `soop-native` ships musl targets the native pack
  cannot support; decision deferred to implementation (drop musl vs. document degraded).

## Surprises & Discoveries

_(updated during implementation)_
