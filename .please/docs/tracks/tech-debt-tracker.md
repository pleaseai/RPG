# Tech Debt Tracker

> Tracked across all tracks. Updated during implementation and retrospectives.

## Active

| ID | Source Track | Description | Priority | Created |
|----|------------|-------------|----------|---------|
| TD-001 | tree-sitter-language-pack-20260526 | Migrate `@kreuzberg/tree-sitter-language-pack` pin off prerelease `1.9.0-rc.10` to a stable `>=1.9.0` once published (only the rc line ships the darwin-x64 prebuild) | Medium | 2026-05-26 |
| TD-002 | tree-sitter-language-pack-20260526 | No musl prebuild — AST parsing unsupported on Alpine/musl hosts; revisit when upstream adds a musl target | Low | 2026-05-26 |
| TD-003 | tree-sitter-language-pack-20260526 | Compiled `soop-native` binaries externalize the native parser (parity with prior web-tree-sitter); decide whether the single-binary distribution should support AST at all | Low | 2026-05-26 |

## Resolved

| ID | Source Track | Description | Resolved In | Date |
|----|------------|-------------|-------------|------|
