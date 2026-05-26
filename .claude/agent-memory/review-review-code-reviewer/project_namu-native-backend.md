---
name: namu-native-backend
description: packages/namu migrated from web-tree-sitter (WASM) to @kreuzberg/tree-sitter-language-pack (native NAPI); byte-offset .text slicing gotcha
metadata:
  type: project
---

packages/namu was migrated from web-tree-sitter (WASM) to `@kreuzberg/tree-sitter-language-pack` (native NAPI). A JsNode->NamuNode adapter (`packages/namu/src/adapter.ts`) bridges the method-based native `Node` API to the property-based `NamuNode` interface consumed UNCHANGED by `@pleaseai/soop-ast` and `@pleaseai/soop-encoder`.

**Why:** Eliminate the emcc/Docker WASM build step; grammars ship as prebuilt native binaries downloaded/cached on demand.

**How to apply:** When reviewing/editing the adapter, the native `Node` API exposes:
- `startByte()`/`endByte()` = UTF-8 **byte offsets** (NOT UTF-16 string indices). `Node` has no `.text`; callers must slice the UTF-8 byte buffer, not `source.slice()`. Slicing the JS string by byte offsets corrupts `.text` for any non-ASCII source — and the namu test suite is ALL ASCII, so it won't catch this. See [[adapter-text-byte-offset-bug]] if filed.
- `Point.column` = UTF-16 code units (differs from web-tree-sitter's byte columns, but fine for JS consumers).
- `Parser.parse(source)` returns `Tree | null` (null on cancel / no language).
- accessors may be method-or-getter; adapter's `value()` helper handles both.
- `childForFieldName` fallback returns a node with `indexInParent=-1` (siblings null) — verified benign: no consumer reads siblings/parent on field-children, only on `.children`-reached nodes.
