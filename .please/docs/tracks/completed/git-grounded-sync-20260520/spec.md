---
product_spec_domain: infrastructure/git
---

# Git-Grounded Sync

> Track: git-grounded-sync-20260520

## Overview

Port the git-management techniques from RPG-Kit (`vendor/RPG-ZeroRepo/RPG-Kit/`) into soop's sync layer and hook installer. The goal is to make incremental sync **commit-aware** (correct after rebase/amend/divergence) and to make `soop init --hooks` **idempotent and coexistence-friendly** with husky / lefthook / pre-commit / worktrees.

Current state: `soop sync` operates on a single-field baseline (`config.github.commit`), has no merge-base divergence detection or file-limit safety net, and `soop init --hooks` appends ad-hoc snippets that duplicate on re-run. This track replaces that surface with a richer model and a safer installer.

## Requirements

### Functional Requirements

- [ ] **FR-1: Read-only git helpers** (`@pleaseai/soop-utils`)
  - Add `readHead(repoDir)` returning `{ headCommit, headShort, headBranch, headTimestamp } | null`
  - Add `stagedChanges(repoDir)` returning `{ modified: string[], renames: Record<string, string> }`
  - Add `workingTreeChanges(repoDir, { includeUntracked })` returning the same shape
  - Add `changedFilesBetween(repoDir, oldRef, newRef = "HEAD")` returning the same shape
  - Add `mergeBase(repoDir, refA, refB)` returning `string | null`
  - All helpers MUST silent-fail: ≤5s timeout, never throw, return `null` / empty result on any failure (missing git, non-repo, shallow, unborn HEAD, timeout)
  - Helpers do NOT mutate working tree, index, or any git state

- [ ] **FR-2: RPG model `gitMeta` field** (`@pleaseai/soop-graph`)
  - Add `gitMeta?: { headCommit: string; headShort?: string; headBranch?: string | null; headTimestamp?: string }` on the graph model
  - Methods: `setGitMeta(meta)`, `clearGitMeta()`
  - `toJSON()` emits `meta.git: {...}` when set; omit entirely when null
  - `fromJSON()` round-trips `meta.git`; drops unknown sub-keys silently
  - **Legacy migration**: on load, if `meta.git` is absent but legacy `config.github.commit` exists, absorb the SHA into `gitMeta.headCommit` (other fields stay null)
  - **Deprecation path**: emit a one-time warn log "config.github.commit is deprecated, use meta.git" when absorption happens; from the next save the legacy field is dropped

- [ ] **FR-3: `syncFromCommitDiff` decision tree** (`@pleaseai/soop-encoder`)
  - New method (or refactor of existing sync) implementing this decision table:

    | Condition                            | Mode          | Reason                  |
    | ------------------------------------ | ------------- | ----------------------- |
    | `forceFull=true`                     | `full`        | `force_full`            |
    | `gitMeta` missing OR not in git repo | `full`        | `baseline` / `no_git`   |
    | `last == HEAD` & clean               | `noop`        | `head_unchanged_clean`  |
    | `last == HEAD` & dirty               | `incremental` | `head_unchanged_dirty`  |
    | `mergeBase(last, HEAD) == last`      | `incremental` | `linear`                |
    | `mergeBase != last`                  | `full`        | `diverged`              |
    | `changed.length > limit`             | `full`        | `over_limit_{N}>{limit}` |

  - `DEFAULT_INCREMENTAL_FILE_LIMIT = 50`, overridable via parameter
  - On `noop`: if branch or timestamp drifted (e.g. branch rename, checkout to same-SHA branch), refresh those fields in `gitMeta` without changing `headCommit`
  - Returns diagnostic object: `{ mode, reason, lastCommit, currentCommit, metaGitAdvancedTo?, savePath, ...incrementalStats }`
  - On success, advances `gitMeta` to current HEAD (unless caller opted out)

- [ ] **FR-4: Rename detection** (`@pleaseai/soop-utils`)
  - `_parseNameStatus(raw)` helper parses `git diff -M --name-status` output
  - Handles `A` / `D` / `M` (single path, modified list) and `R<score>` / `C<score>` (two paths, populates `renames` map AND adds new path to `modified` so it gets reparsed)
  - Filters to `.ts`/`.tsx`/`.js`/`.jsx`/`.py` by default; configurable via option
  - Returns `{ modified: string[], renames: Record<string, string> }`
  - Used by all 3 diff helpers (`stagedChanges`, `workingTreeChanges`, `changedFilesBetween`)

- [ ] **FR-5: `stagedOnly` mode** (`@pleaseai/soop-encoder`, `@pleaseai/soop-cli`)
  - `syncFromCommitDiff` accepts `stagedOnly: boolean` (default `false`)
  - When `true` and HEAD unchanged: use `stagedChanges()` instead of `workingTreeChanges()`
  - When `true` and linear advance: union of `changedFilesBetween(last, HEAD)` + `stagedChanges()` (working-tree-only-not-staged ignored)
  - **CLI exposure**: `soop sync --staged-only` is a documented public flag (appears in `--help`); pre-commit hook calls it the same way as a user would

- [ ] **FR-6: Sentinel-block hook installer** (`@pleaseai/soop-cli`)
  - Atomic replaceable blocks delimited by `# SOOP-BEGIN <block_name>` / `# SOOP-END <block_name>`
  - `installHookSnippet(hooksDir, hookName, blockName, body, { legacyBlocks })`
  - Preserves shebang line (`#!/bin/sh`); creates one if hook file is new
  - Preserves all user-authored content outside the sentinel block
  - `legacyBlocks: Array<{ marker: string; lineCount: number }>` — for each legacy snippet, strip `lineCount` lines starting from the line containing `marker`. Used to migrate pre-sentinel installs cleanly without duplicating
  - Re-running `soop init --hooks` is idempotent: same input → same hook file content

- [ ] **FR-7: Hook directory resolution** (`@pleaseai/soop-cli`)
  - `resolveGitHooksDir(projectPath)` returns `Path | null`
  - Resolution order:
    1. `git config --get core.hooksPath` (honors husky / lefthook / pre-commit overrides); expand `~`; resolve relative paths against `projectPath`
    2. If `<project>/.git` is a directory → `<project>/.git/hooks`
    3. If `<project>/.git` is a file → parse `gitdir: <path>` first line; if `gitdir.parent.basename == "worktrees"` then return `<main>/.git/hooks` (worktrees share hooks with main repo); otherwise return `<gitdir>/hooks` (`--separate-git-dir` case)
    4. Otherwise → `null` (no git checkout; caller skips hook install)

### Non-functional Requirements

- [ ] **NFR-1**: All read-only helpers complete in well under 1 second on a healthy repo (designed for SessionStart / pre-commit hook latency budget)
- [ ] **NFR-2**: `syncFromCommitDiff` returns a JSON-serializable diagnostic dict (consumable by hooks emitting structured logs)
- [ ] **NFR-3**: No new dependencies beyond Node.js built-ins (`child_process`, `fs`, `path`); `simple-git` or similar is NOT introduced
- [ ] **NFR-4**: TypeScript types exported from package barrels are stable; only additive changes to public API surface

## Acceptance Criteria

- [ ] **AC-1**: All 5 git helpers covered by unit tests using both persistent fixture repos and per-test temporary repos created via `mktemp -d` + `git init` + scripted commits; subprocess mocks are NOT used. Coverage includes: missing git binary, non-repo directory, unborn HEAD, detached HEAD, shallow clone, timeout (slow git simulation), rename detection with various similarity scores
- [ ] **AC-2**: `gitMeta` round-trips through `toJSON`/`fromJSON` losslessly; loading a graph with only legacy `config.github.commit` produces a graph with `gitMeta.headCommit` populated and emits exactly one deprecation warning per process
- [ ] **AC-3**: `syncFromCommitDiff` decision tree has a test case for every row in the table above, asserting the correct `mode` and `reason` strings
- [ ] **AC-4**: Integration test: simulate `last == HEAD` clean → noop, then `git commit` a single file → incremental linear, then `git reset --hard HEAD~1` → diverged → full
- [ ] **AC-5**: `installHookSnippet` is idempotent — running 3 times produces byte-identical output; user content (custom shebang, unrelated snippets) preserved verbatim
- [ ] **AC-6**: `resolveGitHooksDir` test matrix covers: plain repo, worktree (`.git` file), `--separate-git-dir`, `core.hooksPath=.husky`, `core.hooksPath=~/dotfiles/hooks` (absolute), no-git directory
- [ ] **AC-7**: Existing `soop sync` integration tests continue to pass; behavior on graphs with no `gitMeta` and no `config.github.commit` is a baseline (full) rebuild without errors
- [ ] **AC-8**: `soop sync --staged-only` flag appears in `soop sync --help` output with a clear description

## Out of Scope

- **post-commit 2-phase + POSIX `mkdir` lock + 60-min stale recovery** — deferred to follow-up track `background-evolve-hooks`
- **`nohup` + `env -u GIT_INDEX_FILE/GIT_DIR` background detach pattern** — deferred to `background-evolve-hooks`
- **`SOOP_NO_GIT_META=1` CI env opt-out** — deferred to `background-evolve-hooks`
- **Codegen branch lifecycle (`GitRunner`, task/batch branches, `batch_completed:` marker)** — deferred until zerorepo code generation is functional
- **Changes to `soop stamp` semantics** — kept as a thin wrapper that now writes through to `gitMeta.headCommit` (no CLI behavior change)
- **Vector index / LanceDB migration related to `gitMeta`** — store layer continues to operate on graph JSON as a whole blob

## Assumptions

- The repository's husky configuration uses `core.hooksPath=.husky/_` (standard husky v9 layout); the new resolver will write into `.husky/_/` and husky's own bootstrap continues to run the chained shim — verified manually before merge
- External tools reading `config.github.commit` are tolerant of the field disappearing in a future minor (deprecation warning gives one cycle of notice)
- The 50-file `DEFAULT_INCREMENTAL_FILE_LIMIT` threshold is reasonable for soop's current target repos; if real-world repos hit it consistently we'll raise it via the `fileLimit` parameter rather than hardcoded change
- Test fixtures may use real git submodules (existing pattern in `tests/fixtures/superjson`) and the CI's `fetch-depth: 0` already supports them
- TypeScript implementation uses Bun's `Bun.spawnSync` (or Node's `child_process.spawnSync`) — chosen at implementation time based on cross-platform behavior

## References

- `vendor/RPG-ZeroRepo/RPG-Kit/scripts/common/git_utils.py` — all 5 read-only helpers + parse logic (Python source)
- `vendor/RPG-ZeroRepo/RPG-Kit/scripts/rpg/service.py:539` — `sync_from_commit_diff` decision tree
- `vendor/RPG-ZeroRepo/RPG-Kit/scripts/rpg/models.py:2022` — `RPG.set_git_meta` + `_GIT_META_KEYS`
- `vendor/RPG-ZeroRepo/RPG-Kit/src/rpgkit_cli/__init__.py:1966-2363` — hook resolver + sentinel installer
