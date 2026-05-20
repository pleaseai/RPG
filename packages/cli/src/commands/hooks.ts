import type { LegacyBlock } from '../hooks/installer'
import { createLogger } from '@pleaseai/soop-utils/logger'
import { installHookSnippet } from '../hooks/installer'
import { resolveGitHooksDir } from '../hooks/resolver'

const log = createLogger('hooks')

/**
 * Body shared by post-merge / post-checkout — runs a full `soop sync`
 * since these fire after operations that may rewrite many files.
 */
const FULL_SYNC_BODY = [
  'if command -v soop >/dev/null 2>&1; then',
  '  soop sync || echo "soop sync failed (exit $?), run \'soop sync\' manually to debug" >&2',
  'elif command -v bunx >/dev/null 2>&1; then',
  '  bunx soop sync || echo "soop sync failed (exit $?), run \'soop sync\' manually to debug" >&2',
  'fi',
].join('\n')

/**
 * Body for pre-commit — uses `--staged-only` so only files in the index
 * contribute to the diff. Working-tree-but-not-staged changes are out
 * of scope for the imminent commit.
 */
const STAGED_SYNC_BODY = [
  'if command -v soop >/dev/null 2>&1; then',
  '  soop sync --staged-only || echo "soop sync failed (exit $?), run \'soop sync --staged-only\' manually to debug" >&2',
  'elif command -v bunx >/dev/null 2>&1; then',
  '  bunx soop sync --staged-only || echo "soop sync failed (exit $?), run \'soop sync --staged-only\' manually to debug" >&2',
  'fi',
].join('\n')

/**
 * Legacy snippet shipped by `soop init --hooks` before sentinel blocks.
 * The 5-line shape (marker comment + 4 body lines) is stripped during
 * upgrade so users don't end up running both the old snippet and the
 * new SOOP block.
 */
const LEGACY_BLOCKS: readonly LegacyBlock[] = [
  { marker: '# Repo Please auto-sync hook', lineCount: 5 },
]

interface HookSpec {
  name: 'pre-commit' | 'post-merge' | 'post-checkout'
  block: string
  body: string
}

const HOOKS: readonly HookSpec[] = [
  { name: 'pre-commit', block: 'pre-commit', body: STAGED_SYNC_BODY },
  { name: 'post-merge', block: 'post-merge', body: FULL_SYNC_BODY },
  { name: 'post-checkout', block: 'post-checkout', body: FULL_SYNC_BODY },
]

/**
 * Install git hooks that keep the soop graph in sync with code changes.
 *
 * - `pre-commit`  → `soop sync --staged-only`
 * - `post-merge`  → `soop sync`
 * - `post-checkout` → `soop sync`
 *
 * Atomic + idempotent: re-running replaces the SOOP-managed block in
 * each hook without touching user-authored content. Pre-sentinel
 * snippets (released before this rewrite) are migrated cleanly via
 * `LEGACY_BLOCKS`. Honors `core.hooksPath` (husky / lefthook /
 * pre-commit) and linked-worktree gitdirs.
 */
export async function installHooks(repoPath: string): Promise<void> {
  const hooksDir = resolveGitHooksDir(repoPath)
  if (hooksDir === null) {
    log.error('Not a git repository — skipping hook install')
    return
  }

  for (const hook of HOOKS) {
    const written = installHookSnippet(hooksDir, hook.name, hook.block, hook.body, {
      legacyBlocks: LEGACY_BLOCKS,
    })
    log.success(`Installed ${hook.name} hook at ${written}`)
  }
}
