# Plan: DependencyGraph with Invocation and Inheritance Tracking

## Overview

- **Source**: Issue #80
- **Issue**: #80
- **Created**: 2026-02-15
- **Approach**: Clean Architecture -- extend existing multi-language tree-sitter infrastructure with dedicated DependencyGraph class

## Context

### Problem

Our `@pleaseai/rpg-encoder` only creates `DependencyEdge` with `dependencyType: 'import'` via path-based import resolution in `encoder.ts:injectDependencies`. No call graph or class hierarchy is tracked. This is identified as a P1 improvement in the vendor comparison analysis (docs/vendor-comparison.md Section 3.3).

### Requirements

- Track function/method invocations as dependency edges (`dependencyType: 'call'`)
- Track class inheritance and interface implementation as dependency edges (`dependencyType: 'inherit' | 'implement'`)
- Support all 6 tree-sitter languages (TypeScript, JavaScript, Python, Rust, Go, Java)
- Symbol resolution with cross-file type inference and fuzzy matching fallback
- No backward compatibility shims or deprecated re-exports -- clean changes only

### Constraints

- Must use tree-sitter (not language-specific AST modules) for multi-language support
- Must integrate cleanly with existing `RPGEncoder.injectDependencies()` pipeline
- No backward compatibility layers -- directly modify existing types and APIs

### Non-Goals

- Python `ast` module integration (vendor approach -- we use tree-sitter instead)
- NetworkX-style graph engine (we use our own RPG graph structure)
- Full method resolution order (MRO) for all edge cases (initial implementation covers common patterns)

## Architecture Decision

Introduce a `DependencyGraph` class in `@pleaseai/rpg-encoder` that:

1. Extends the existing `DependencyEdge` schema with new `dependencyType` values (`call`, `inherit`, `implement`, `use`)
2. Uses tree-sitter queries per language for call/inheritance extraction
3. Provides subgraph view/filter interfaces for edge-type-specific traversal
4. Integrates into the existing `injectDependencies()` pipeline alongside import resolution

This leverages our multi-language tree-sitter advantage over the vendor's Python-only approach.

## Tasks

- [ ] T001 [P] Extend DependencyEdge with new dependency types (file: packages/graph/src/edge.ts)
- [ ] T002 [P] Design and create DependencyGraph class (file: packages/encoder/src/dependency-graph.ts)
- [ ] T003 Implement invocation tracking via tree-sitter queries (depends on T001, T002, file: packages/encoder/src/dependency-graph.ts)
- [ ] T004 Implement inheritance tracking via tree-sitter queries (depends on T001, T002, file: packages/encoder/src/dependency-graph.ts)
- [ ] T005 Add tree-sitter queries for all supported languages (depends on T003, T004, file: packages/utils/src/ast/)
- [ ] T006 Implement symbol resolution with cross-file inference (depends on T003, file: packages/encoder/src/symbol-resolver.ts)
- [ ] T007 Integrate with RPGEncoder.injectDependencies() (depends on T002, T005, T006, file: packages/encoder/src/encoder.ts)

## Key Files

### Create

| File | Description |
|------|-------------|
| `packages/encoder/src/dependency-graph.ts` | DependencyGraph class with subgraph views |
| `packages/encoder/src/symbol-resolver.ts` | Symbol resolution and type inference |

### Modify

| File | Description |
|------|-------------|
| `packages/graph/src/edge.ts` | Extend DependencyEdge with `call`, `inherit`, `implement`, `use` types |
| `packages/encoder/src/encoder.ts` | Integrate DependencyGraph into `injectDependencies()` |
| `packages/utils/src/ast/parser.ts` | Add tree-sitter queries for call/inheritance extraction |

### Reuse

| File | Description |
|------|-------------|
| `packages/utils/src/ast/` | Existing tree-sitter multi-language infrastructure |
| `packages/graph/src/edge.ts` | Existing DependencyEdge schema |
| `vendor/RPG-ZeroRepo/zerorepo/rpg_gen/base/rpg/dep_graph.py` | Reference implementation |

## Verification

### Automated Tests

- [ ] Unit tests for DependencyEdge new types (call, inherit, implement, use)
- [ ] Unit tests for call graph extraction per language (TS, JS, Python, Rust, Go, Java)
- [ ] Unit tests for inheritance hierarchy extraction per language
- [ ] Unit tests for symbol resolution (local type inference, cross-file)
- [ ] Unit tests for fuzzy matching fallback
- [ ] Integration test for DependencyGraph with multi-file project
- [ ] Integration test for encoder pipeline with full dependency analysis
- [ ] All existing tests updated and passing (no backward compatibility shims)

### Manual Testing

- [ ] Encode a real repository and verify call edges appear in the graph
- [ ] Encode a repository with class hierarchies and verify inherit/implement edges
- [ ] Compare dependency edge count before/after to confirm richer graph output

### Acceptance Criteria Check

- [ ] AC-1: DependencyEdge supports call, inherit, implement, use dependency types
- [ ] AC-2: Function/method calls extracted via tree-sitter for all 6 languages
- [ ] AC-3: Class hierarchy (extends/implements) extracted for all applicable languages
- [ ] AC-4: Cross-file symbol resolution resolves call targets using import graph
- [ ] AC-5: Existing import edges still work (no compatibility shims needed)
- [ ] AC-6: RPGEncoder.injectDependencies() produces richer dependency graph

## Notes

- The vendor reference (`dep_graph.py`, 1023 lines) uses Python `ast` module -- we adapt the concepts to tree-sitter
- Our multi-language tree-sitter support (6 languages) is a significant advantage over vendor's Python-only approach
- Fuzzy matching should be conservative to avoid false positive edges
- Consider performance impact on large repositories -- may need batching or caching for symbol resolution
- **No backward compatibility**: Per user instruction, do NOT add backward compatibility shims, deprecated re-exports, or compatibility layers. Make clean, direct changes to existing types and APIs.
