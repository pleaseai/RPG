# Migrate tree-sitter backend to native @kreuzberg/tree-sitter-language-pack

> Track: tree-sitter-language-pack-20260526
> Type: refactor

## Overview

`packages/namu` currently produces tree-sitter parsers by compiling 11 individual
`tree-sitter-*` npm grammars into WASM via `tree-sitter build --wasm` (`build.ts`),
loaded at runtime through `web-tree-sitter`. This requires an `emcc`/Docker build
step, ships no committed grammars (`packages/namu/wasm/` holds only `.gitkeep`), and
caps language support at the 11 hand-listed grammars.

This track replaces that pipeline with the **native NAPI** package
`@kreuzberg/tree-sitter-language-pack` (https://github.com/kreuzberg-dev/tree-sitter-language-pack),
which ships prebuilt platform binaries for 300+ languages with on-demand parser
download + local caching. `packages/namu` is rewritten to wrap the native
`getParser()`/`getLanguage()` API and expose the **existing** `NamuParser` /
`NamuNode` / `NamuTree` interface through a `JsNode → NamuNode` adapter, so the
tuned entity/import extraction in `packages/ast/src/parser.ts` (`LANGUAGE_CONFIGS`)
remains unchanged. The custom WASM build pipeline is removed entirely.

### Decided approach (confirmed with user)

- **Variant: native NAPI**, not the WASM variant — chosen for 300+ language coverage.
- **Version pin: `1.9.0-rc.10`** (the npm `next` dist-tag). Required: the `darwin-x64`
  (Intel Mac) prebuild is published only on the rc line (`1.8.0-rc.36`, `1.9.0-rc.1..rc.10`);
  stable `latest` `1.8.1` has **no** Intel Mac binary (upstream issue
  [#127](https://github.com/kreuzberg-dev/tree-sitter-language-pack/issues/127),
  fixed in `79cdb7ab`, shipping only in the rc line so far). The dev machine here is
  `x86_64` Darwin, so darwin-x64 support is mandatory.
- **Integration: low-level swap** — wrap raw AST (`getParser()` → `JsTree.rootNode` →
  `JsNode`); do **not** adopt the high-level `process()` API.
- **Migration: full replacement** — remove `build.ts`, `web-tree-sitter`, the 11
  `tree-sitter-*` devDependencies, `tree-sitter-cli`, the `build:wasm` script, and
  `packages/namu/wasm/`.

## Scope

- **Backend swap** — `packages/namu` rewritten on top of `@kreuzberg/tree-sitter-language-pack`.
- **`JsNode → NamuNode` adapter** — bridge the native method-based API to the existing
  property-based `NamuNode` interface consumed by `packages/ast`. Surface to reproduce:
  - `.type` ← `kind()`; `.text` ← `source.slice(startByte(), endByte())`
  - `.children` (all), `.namedChildren`; `.child(i)` / `.namedChild(i)`
  - `.childForFieldName(name)` ← `childByFieldName(name)`
  - `.startPosition` / `.endPosition` `{row, column}` ← `startPosition()` / `endPosition()`
    (zero-indexed; `parser.ts` adds `+1` for lines)
  - `.startIndex` / `.endIndex` ← `startByte()` / `endByte()`
  - `.parent` ← `parent()`; `.previousSibling` / `.nextSibling`
  - `.hasError` ← `isError()`; `.isNamed` ← `isNamed()`; `.isMissing` ← `isMissing()`
  - `.toString()` ← `toSexp()`
- **Deterministic parser provisioning** — configure a known cache directory and add a
  pre-download step (`init()` / `download()` / `downloadAll()`) so CI and the
  `bun build --compile` single binary (`packages/soop-native`) work offline/reproducibly.
- **Cleanup** — delete the WASM build pipeline and its dependencies; remove the
  `build:wasm` script and the `wasm/` asset directory.
- **Docs** — update CLAUDE.md / `tech-stack.md` to reflect the native backend, the
  version pin, the parser-cache model, and the dropped emcc/Docker requirement.

## Success Criteria

- [ ] SC-1: All existing `packages/ast` and `packages/encoder` tests pass unchanged;
      `ParseResult` / `CodeEntity` output for the 11 currently supported languages
      (typescript, javascript, python, rust, go, java, csharp, c, cpp, ruby, kotlin)
      remains equivalent (behavior preservation is the acceptance bar).
- [ ] SC-2: The native `.node` addon loads and parses successfully under **Bun 1.3.14**
      on both `darwin-x64` (local) and `linux-x64-gnu` (CI `ubuntu-latest`).
- [ ] SC-3: A fresh checkout runs `bun install && bun run test` with **no** emcc/Docker
      and **no** `build:wasm` step; `packages/namu/build.ts`, `web-tree-sitter`, the 11
      `tree-sitter-*` devDeps, `tree-sitter-cli`, and `packages/namu/wasm/` are removed.
- [ ] SC-4: Parser provisioning is deterministic — CI and the compiled single binary
      obtain required grammars without relying on ad-hoc first-run network downloads
      (configured cache dir + pre-download step).
- [ ] SC-5: `packages/ast/src/parser.ts` requires no logic changes beyond what the
      adapter cannot absorb (target: zero or near-zero edits to extraction logic).

## Constraints

- **No behavior change**: external output of `ASTParser.parse()` for the 11 supported
  languages must be equivalent before and after.
- **Backward-compatible interface**: the `NamuParser` / `NamuNode` / `NamuTree` /
  `SupportedLanguage` exports from `@pleaseai/soop-namu` keep their existing shape so
  `packages/ast` and downstream consumers are unaffected.
- **Platform support**: prebuilds exist for `darwin-x64`, `darwin-arm64`,
  `linux-x64-gnu`, `linux-arm64-gnu`, `win-x64`, `win-arm64`. **No musl** target —
  Alpine/musl environments are unsupported (acceptable: CI is `ubuntu-latest` gnu;
  document the constraint).
- **Prerelease pin**: `1.9.0-rc.10` is a prerelease and must be pinned exactly; treat
  as temporary pending a stable release (see Out of Scope follow-up).

## Out of Scope

- Expanding tuned entity/import extraction (`LANGUAGE_CONFIGS`) beyond the existing 11
  languages. Parsing may become available for more of the 300+ languages, but tuned
  extraction stays at the current 11; broader coverage is a follow-up track.
- Adopting the high-level `process()` intelligence API (`structure` / `symbols` /
  `docstrings` / `diagnostics` / `chunks`).
- Migrating off the `1.9.0-rc.10` prerelease — a follow-up will move to a stable
  `>=1.9.0` (or `>=1.8.2` if it ships `darwin-x64`) once published.
- Supporting musl/Alpine runtimes.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Bun fails to load the NAPI `.node` addon | High | SC-2 validation spike performed **first**, before full migration |
| Prerelease (`rc.10`) is yanked or behaves unexpectedly | Medium | Exact pin; follow-up to stable tracked in Out of Scope |
| On-demand download breaks CI/offline/single-binary | Medium | Configured cache dir + explicit pre-download step (SC-4) |
| `JsNode→NamuNode` semantic drift (positions, `.text`, fields) | Medium | Behavior-preservation tests (SC-1); adapter unit tests against known fixtures |
| New darwin-x64 binary unavailable on other Intel dev machines | Low | Documented; pin guarantees the prebuild package resolves |
