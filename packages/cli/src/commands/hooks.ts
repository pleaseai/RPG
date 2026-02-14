import { chmodSync, existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createLogger } from '@pleaseai/rpg-utils/logger'

const log = createLogger('hooks')

const HOOK_CONTENT = `#!/bin/sh
# RPG auto-sync hook — installed by "rpg init --hooks"
# Runs rpg sync after git operations. Failures do not block git.

if command -v rpg >/dev/null 2>&1; then
  rpg sync 2>/dev/null || true
elif command -v bunx >/dev/null 2>&1; then
  bunx rpg sync 2>/dev/null || true
fi
`

const HOOK_NAMES = ['post-merge', 'post-checkout'] as const

/**
 * Install git hooks that run "rpg sync" after merge/checkout.
 * Does not overwrite existing hooks.
 */
export async function installHooks(repoPath: string): Promise<void> {
  const gitDir = path.join(repoPath, '.git')
  if (!existsSync(gitDir)) {
    log.error('Not a git repository (no .git directory)')
    return
  }

  const hooksDir = path.join(gitDir, 'hooks')

  for (const hookName of HOOK_NAMES) {
    const hookPath = path.join(hooksDir, hookName)

    if (existsSync(hookPath)) {
      log.warn(`${hookName} hook already exists, skipping`)
      continue
    }

    await writeFile(hookPath, HOOK_CONTENT)
    chmodSync(hookPath, 0o755)
    log.success(`Installed ${hookName} hook`)
  }
}
