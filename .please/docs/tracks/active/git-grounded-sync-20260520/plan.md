# Plan: Git-Grounded Sync

> Track: git-grounded-sync-20260520
> Spec: [spec.md](./spec.md)

## Overview

- **Source**: /please:plan
- **Track**: git-grounded-sync-20260520
- **Issue**: #306
- **Created**: 2026-05-20
- **Approach**: New silent-fail git module + extended meta schema + decision-tree sync + sentinel-block hooks (coexisting with existing APIs)

## Purpose

Port RPG-Kit's git-management techniques into soop while preserving the existing throwing-helper API surface and sidecar-meta architecture. Net effect: `soop sync` becomes commit-aware (correct after rebase/amend/divergence) and `soop init --hooks` becomes idempotent and coexistence-friendly with husky/lefthook/worktrees.

## Context

soop already has a partial git layer that differs from RPG-Kit's reference in two important ways:

1. **Baseline storage is a sidecar `.meta.json` file** (see `packages/graph/src/meta.ts:5-14`), not embedded in the graph JSON. Current schema has `meta.github = { owner, repo, commit, pathPrefix }`. The spec's `gitMeta` field therefore maps cleanly onto an additive `meta.git = { headCommit, headShort, headBranch, headTimestamp }` extension to the existing zod schema.

2. **Existing git helpers throw on failure** (`packages/utils/src/git-helpers.ts`). `commands/sync.ts:50-59` wraps them in try/catch and `process.exit(1)`s on git errors. The new silent-fail helpers (FR-1) need a different name space so they don't collide with the throwing variants used by current code.

The existing `sync.ts` already (a) reads `meta.github.commit` as canonical baseline, (b) computes `getMergeBase(defaultBranch, HEAD)`, (c) decides "needs evolve" based on `!isOnDefaultBranch && canonicalCommit`. It does NOT have: merge-base-vs-last-commit divergence check, file-limit safety net, noop/incremental/full mode distinction, staged-only mode, or rename detection. The decision tree (FR-3) replaces this ad-hoc logic.

The existing `hooks.ts` installs `post-merge` + `post-checkout` only, skips if a hook file already exists, has no idempotent re-install path, and writes to `.git/hooks/` directly (no `core.hooksPath`, no worktree support, no pre-commit). The rewrite adds pre-commit and switches to sentinel-block semantics.

## Architecture Decision

**Why two parallel git APIs instead of refactoring the existing one?**

`getHeadCommitSha`, `getMergeBase`, `getCurrentBranch`, `getDefaultBranch` are exported from `@pleaseai/soop-utils/git-helpers` and used by `sync.ts` with explicit try/catch handling. Changing their throw semantics would silently change error-reporting behavior across the CLI (currently a missing git binary fails fast with a clear error; under silent-fail it would degrade to full rebuild without telling the user why).

Decision: introduce a new module `@pleaseai/soop-utils/git` with silent-fail semantics for hook-and-sync internals; leave `git-helpers` untouched. The new module is the canonical surface for future code; old helpers can be deprecated in a later track.

**Why extend `RPGMetaSchema` rather than add fields to `RepositoryPlanningGraph`?**

The graph class is a runtime structure (nodes + edges + adapters) and is intentionally large (818 LOC). The meta sidecar (66 LOC) is the natural home for "what commit was this baseline computed against." Adding `git` next to the existing `github` field is one zod field addition and preserves separation of concerns.

**Legacy compat strategy (Q1 from spec questioning):**

- On load: if `meta.git` absent but `meta.github.commit` present → populate `gitMeta.headCommit` from `github.commit`, emit one-time process-scoped deprecation warning via `createLogger('meta')`.
- On save: write both fields during the transition window (this track + one minor). The `github.commit` field stops being authoritative immediately — readers prefer `git.headCommit` when both exist.

**Test strategy (Q2):**

- Per-test temporary git repos created via `mktemp -d` + `git init` + scripted commits (Bun's `Bun.spawnSync` for setup; `node:fs` for fixtures). Covers all decision-tree branches without flaky persistent state.
- Existing `tests/fixtures/superjson` submodule continues to serve integration tests that need a real multi-commit history.
- No subprocess mocking — defeats the purpose of helpers whose correctness depends on real git output.

**CLI surface (Q3):** `soop sync --staged-only` is a documented public flag.

**Hook re-entry (Q4):** sentinel-block atomic replace with `legacyBlocks` migration of the current `HOOK_CONTENT` marker.

## Architecture Diagram

```
soop sync (CLI)
  │
  ├─→ readHead(repoPath) ──────────────────────────────┐
  │   @pleaseai/soop-utils/git  (silent-fail)          │
  │                                                    ▼
  ├─→ load meta sidecar ─→ meta.git.headCommit ─→ syncFromCommitDiff()
  │   @pleaseai/soop-graph/meta                  @pleaseai/soop-encoder/sync
  │   (zod schema with new `git` field)            │
  │                                                ├─ mergeBase, changedFilesBetween,
  │                                                │  stagedChanges, workingTreeChanges
  │                                                │  (all silent-fail, .ts/.py filter)
  │                                                ▼
  │                                          { mode, reason, ... } diagnostic
  │                                                │
  └─→ on success: setGitMeta(current HEAD) ←──────┘

soop init --hooks (CLI)
  │
  ├─→ resolveGitHooksDir(projectPath)
  │   (core.hooksPath → .git/hooks → worktree gitdir)
  │
  └─→ installHookSnippet(hooksDir, name, blockName, body, {legacyBlocks})
      (# SOOP-BEGIN/END atomic replace; legacy 'Repo Please auto-sync hook' marker stripped)
      ├─ pre-commit:    soop sync --staged-only
      ├─ post-merge:    soop sync
      └─ post-checkout: soop sync
```

## Affected Files & Nodes

_RPG unavailable (rpg.json not initialized for this repo) — file-level impact only._

| Layer | File | Change |
|---|---|---|
| utils | `packages/utils/src/git/index.ts` (NEW) | New silent-fail module |
| utils | `packages/utils/src/git/name-status.ts` (NEW) | R/C parser |
| utils | `packages/utils/package.json` | Add `./git` subpath export |
| utils | `packages/utils/tests/git/*.test.ts` (NEW) | Unit tests for new helpers |
| graph | `packages/graph/src/meta.ts` | Add `git` field + migration helper |
| graph | `packages/graph/tests/meta.test.ts` | Round-trip + legacy migration tests |
| encoder | `packages/encoder/src/sync/commit-diff.ts` (NEW) | Decision tree |
| encoder | `packages/encoder/src/sync/index.ts` (NEW) | Barrel export |
| encoder | `packages/encoder/src/index.ts` | Re-export new sync module |
| encoder | `packages/encoder/package.json` | Add `./sync` subpath export |
| encoder | `packages/encoder/tests/sync/commit-diff.test.ts` (NEW) | Decision-tree matrix tests |
| cli | `packages/cli/src/hooks/resolver.ts` (NEW) | Hook dir resolution |
| cli | `packages/cli/src/hooks/installer.ts` (NEW) | Sentinel block installer |
| cli | `packages/cli/src/commands/hooks.ts` | Rewrite to use new installer; add pre-commit |
| cli | `packages/cli/src/commands/sync.ts` | Use `syncFromCommitDiff`, add `--staged-only` |
| cli | `packages/cli/src/commands/init.ts` | `--hooks` wiring updated transparently |
| cli | `packages/cli/tests/hooks/*.test.ts` (NEW) | Resolver + installer tests |
| cli | `packages/cli/tests/cli-init-sync.integration.test.ts` | Update existing assertions if needed; add rebase/divergence scenarios |

## Tasks

- [x] T001 [P] Add silent-fail `readHead(repoDir)` returning `{ headCommit, headShort, headBranch, headTimestamp } | null` (file: packages/utils/src/git/read-head.ts) — ≤5s timeout, never throws, returns null on missing git/non-repo/unborn HEAD; unit tests cover: clean repo, detached HEAD, unborn (`git init` only), missing git binary path, non-existent directory
- [x] T002 [P] Add `_parseNameStatus(raw, { filterExt? })` parser for `git diff -M --name-status` output (file: packages/utils/src/git/name-status.ts) — parses `A`/`D`/`M` + `R<score>`/`C<score>` lines into `{ modified: string[], renames: Record<string,string> }`; default filter `['.ts','.tsx','.js','.jsx','.py']`; rename target added to `modified`; unit tests cover all 5 status types, similarity scores R98/C50, tab edge cases, empty input
- [x] T003 [P] Add silent-fail diff helpers `stagedChanges`, `workingTreeChanges`, `changedFilesBetween`, `mergeBase` (file: packages/utils/src/git/diff.ts) — all use `_parseNameStatus`; `workingTreeChanges` accepts `{ includeUntracked = true }`; unit tests against per-test tmp repos covering linear advance, dirty tree with renames, staged vs working-tree distinction, unborn HEAD fallback in `stagedChanges` (depends on T002)
- [x] T004 [P] Add `./git` subpath export to `packages/utils/package.json`; barrel exports from `packages/utils/src/git/index.ts`; ensure tsdown picks up new entry (depends on T001, T002, T003)
- [x] T005 [P] Extend `RPGMetaSchema` in `packages/graph/src/meta.ts` with optional `git: { headCommit, headShort?, headBranch?, headTimestamp? }` field; add `setGitMeta(meta, data)` and legacy-migration helper that absorbs `github.commit` → `git.headCommit` and emits one-time process-scoped deprecation warn; update `serializeMeta`/`deserializeMeta`; round-trip + legacy-migration tests in `packages/graph/tests/meta.test.ts`
- [x] T006 Build `syncFromCommitDiff({ repoPath, lastMeta, options })` returning `{ mode, reason, lastCommit, currentCommit, changed, renames, metaGitAdvancedTo?, ... }` (file: packages/encoder/src/sync/commit-diff.ts) — implements full decision table from spec FR-3; `forceFull`, `stagedOnly`, `fileLimit` (default 50) options; test matrix covers every row of the decision table including over-limit safety net (depends on T001, T002, T003, T005)
- [x] T007 [P] Add `resolveGitHooksDir(projectPath): string | null` (file: packages/cli/src/hooks/resolver.ts) — resolution order: (a) `git config --get core.hooksPath` (expand `~`, resolve relative); (b) `.git` directory → `.git/hooks`; (c) `.git` file → parse `gitdir:`; worktree-aware (`gitdir.parent.basename === 'worktrees'` → main repo hooks); unit tests cover all four branches plus husky shape `.husky/_` and absolute `core.hooksPath`
- [x] T008 [P] Add `installHookSnippet(hooksDir, hookName, blockName, body, { legacyBlocks })` + `_stripHookBlock` (file: packages/cli/src/hooks/installer.ts) — atomic `# SOOP-BEGIN <name>` / `# SOOP-END <name>` block replacement, preserves shebang and user content, applies `legacyBlocks: Array<{ marker, lineCount }>` migration; tests: empty file, existing user content, existing sentinel (replace), legacy snippet (migrate), 3x idempotency
- [x] T009 Rewrite `packages/cli/src/commands/hooks.ts` to use new installer + resolver; add `pre-commit` hook running `soop sync --staged-only`; convert existing `post-merge`/`post-checkout` to sentinel blocks; declare `legacyBlocks` containing the old `# Repo Please auto-sync hook` marker so users upgrading don't get duplicate snippets; integration test installs hooks twice in tmp repo and asserts byte-identical output (depends on T007, T008)
- [x] T010 Refactor `packages/cli/src/commands/sync.ts` to use `syncFromCommitDiff`: read `meta.git.headCommit` (fallback to legacy `meta.github.commit`), feed into decision tree, advance `meta.git` on success, write diagnostic dict via `log.info`; add `--staged-only` CLI flag exposed in `--help`; preserve `--force` mapping to `forceFull: true`; existing behavior (default-branch-only sync) becomes a subset of the new logic (depends on T005, T006)
- [x] T011 Update `packages/cli/src/commands/init.ts` so `--hooks` triggers the new installer for all three hooks; no other init changes required (depends on T009)
- [x] T012 Add integration test scenarios in `packages/cli/tests/cli-init-sync.integration.test.ts` (or new file `cli-sync-decision.integration.test.ts`): linear-advance incremental, rebase → diverged → full, amend → diverged → full, over-limit file count → full, staged-only vs working-tree-only distinction (depends on T010, T011)

## Dependencies

```
T001 [P] ──┐
T002 [P] ──┼──→ T003 [P] ──┬──→ T004 [P]
           │                │
T005 [P] ──┴────────────────┼──→ T006 ─────────┐
                            │                  │
T007 [P] ──┐                │                  │
           ├──→ T009 ───────┼──→ T011 ─────────┼──→ T012
T008 [P] ──┘                │                  │
                            └──→ T010 ─────────┘
```

Wave plan:
- **Wave 1** (parallel): T001, T002, T005, T007, T008
- **Wave 2**: T003 (after T002), T004 (after T001/T002/T003)
- **Wave 3**: T006 (after T001/T002/T003/T005), T009 (after T007/T008)
- **Wave 4**: T010 (after T005/T006), T011 (after T009)
- **Wave 5**: T012 (after T010/T011)

## Key Files

- `packages/utils/src/git-helpers.ts:1-77` — existing throwing helpers (kept untouched as a backward-compat surface)
- `packages/graph/src/meta.ts:5-14` — `RPGMetaSchema` extension point
- `packages/cli/src/commands/sync.ts:8,50-59,67-77,111-160` — current ad-hoc decision logic to be replaced
- `packages/cli/src/commands/hooks.ts:8-17,19-47` — current monolithic installer to be replaced
- `packages/cli/src/cli.ts:459-485` — `stamp` and `last-commit` commands (need adjustment for new meta field)
- `packages/cli/tests/cli-init-sync.integration.test.ts:232` — existing assertion `graph.config.github.commit` needs to migrate to `meta.git.headCommit` once T005 lands
- `vendor/RPG-ZeroRepo/RPG-Kit/scripts/common/git_utils.py:443-741` — reference: all 5 read-only helpers + parse logic
- `vendor/RPG-ZeroRepo/RPG-Kit/scripts/rpg/service.py:539-732` — reference: decision tree implementation
- `vendor/RPG-ZeroRepo/RPG-Kit/src/rpgkit_cli/__init__.py:1966-2363` — reference: hook resolver + sentinel installer

## Verification

Pre-merge checklist:
1. `bun run typecheck` — no new type errors
2. `bun run lint` — no new lint errors
3. `bun run test:unit` — all 5 new test files pass; existing tests pass
4. `bun run test:integration` — new decision-tree scenarios pass; existing `cli-init-sync` passes (with assertion migration)
5. Manual: run `soop init --hooks` twice in a tmp repo, diff hook files → byte-identical
6. Manual: in a worktree (`git worktree add ../wt main`), run `soop init --hooks` → hooks written to main repo's `.git/hooks`
7. Manual: set `git config core.hooksPath .husky/_` and run `soop init --hooks` → hooks written to `.husky/_/`
8. Manual: `soop sync --help` shows `--staged-only` flag with description
9. Manual: rebase HEAD~3 → run `soop sync` → diagnostic dict logs `mode: full, reason: diverged`

## Progress

_To be populated by /please:implement._

## Decision Log

- **2026-05-20**: Parallel git API (new `@pleaseai/soop-utils/git` module alongside existing `git-helpers`) chosen over refactor — preserves error-reporting semantics in existing call sites and gives a clean migration target without breaking changes.
- **2026-05-20**: `gitMeta` added to `RPGMetaSchema` (sidecar) rather than `RepositoryPlanningGraph` (graph itself) — aligns with soop's existing meta-sidecar architecture and is one zod field addition instead of touching the 818-LOC graph class.
- **2026-05-20**: Legacy `meta.github.commit` write continues for one minor (transitional dual-write); reads prefer `meta.git.headCommit` immediately. Deprecation warning emitted once per process on first absorption.
- **2026-05-20**: No subprocess mocking — git's actual behavior is the contract under test. Per-test tmp repos via `mktemp -d`.

## Surprises & Discoveries

- soop's current `sync` already calls `getMergeBase` — but with `(defaultBranch, HEAD)`, not `(lastCommit, HEAD)`. This is fundamentally different semantics: "how far has my branch diverged from main" vs "is my baseline still on the current history line." Both have value; the new decision tree subsumes the latter and the former becomes a separate concern (the "needs evolve" check based on branch position).
- `getDefaultBranch` falls back to literal `'main'` with a warning when nothing else resolves — fine for current code but worth noting that the new silent-fail philosophy avoids logging-by-default in helpers (caller decides).
- The current `hooks.ts` skips installing if a hook file already exists, even if that file is empty or has only user content. The sentinel-block design improves this: user content is preserved and only the SOOP block is managed.
