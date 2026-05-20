import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Description of an older snippet shape that may exist in a user's hook
 * file. Used during upgrades so the old snippet is stripped before the
 * new sentinel block is written — without this, users would end up running
 * both the old and new snippets after upgrade.
 *
 * - `marker`: substring of the snippet's first line (typically a comment
 *   like `# Repo Please auto-sync hook`).
 * - `lineCount`: total number of consecutive lines the snippet occupies,
 *   starting at the marker line.
 */
export interface LegacyBlock {
  marker: string
  lineCount: number
}

export interface InstallHookSnippetOptions {
  legacyBlocks?: readonly LegacyBlock[]
}

/**
 * Install or replace a soop-owned block in `<hooksDir>/<hookName>`.
 *
 * Layout written:
 *
 *     #!/bin/sh
 *     <pre-existing user content>
 *
 *     # SOOP-BEGIN <blockName>
 *     <body>
 *     # SOOP-END <blockName>
 *
 * Atomic-replaceable: subsequent runs find the existing sentinels and
 * replace the whole block, so upgrades land cleanly without piling
 * snippets on top of old ones. `legacyBlocks` migrates pre-sentinel
 * installs in a single pass; once migrated, the legacy patterns are
 * no-ops.
 *
 * Creates the hook file with `#!/bin/sh` if absent; preserves any
 * user-authored shebang otherwise. Returns the absolute hook path.
 */
export function installHookSnippet(
  hooksDir: string,
  hookName: string,
  blockName: string,
  body: string,
  options: InstallHookSnippetOptions = {},
): string {
  mkdirSync(hooksDir, { recursive: true })
  const hookPath = path.join(hooksDir, hookName)
  const existing = existsSync(hookPath) ? readFileSync(hookPath, 'utf-8') : ''

  const cleaned = stripHookBlock(existing, blockName, options.legacyBlocks ?? []).replace(/\n+$/, '')

  let prefix: string
  if (cleaned.trim().length === 0)
    prefix = '#!/bin/sh\n'
  else if (cleaned.trimStart().startsWith('#!'))
    prefix = `${cleaned}\n`
  else
    prefix = `#!/bin/sh\n${cleaned}\n`

  const begin = `# SOOP-BEGIN ${blockName}`
  const end = `# SOOP-END ${blockName}`
  const block = `\n${begin}\n${body.replace(/\n+$/, '')}\n${end}\n`

  writeFileSync(hookPath, prefix + block, 'utf-8')
  chmodSync(hookPath, 0o755)
  return hookPath
}

/**
 * Return `text` with any soop-owned hook content removed.
 *
 * Two cleanup passes:
 *   1. Strip the sentinel block `# SOOP-BEGIN <blockName>` … `# SOOP-END <blockName>`.
 *   2. For each `(marker, lineCount)` legacy snippet, drop the marker line
 *      plus `lineCount - 1` lines following it.
 *
 * Lines outside both passes survive verbatim, including user shebangs.
 */
export function stripHookBlock(
  text: string,
  blockName: string,
  legacyBlocks: readonly LegacyBlock[] = [],
): string {
  const beginSent = `# SOOP-BEGIN ${blockName}`
  const endSent = `# SOOP-END ${blockName}`
  const lines = text.split('\n')

  // Pass 1: strip sentinel block.
  const afterSentinels: string[] = []
  let inside = false
  for (const line of lines) {
    const stripped = line.trim()
    if (!inside && stripped === beginSent) {
      inside = true
      continue
    }
    if (inside && stripped === endSent) {
      inside = false
      continue
    }
    if (inside)
      continue
    afterSentinels.push(line)
  }

  // Pass 2: strip legacy snippets by (marker, lineCount).
  if (legacyBlocks.length === 0)
    return afterSentinels.join('\n')

  const out: string[] = []
  let skip = 0
  for (const line of afterSentinels) {
    if (skip > 0) {
      skip -= 1
      continue
    }
    let matched = false
    for (const { marker, lineCount } of legacyBlocks) {
      if (line.includes(marker)) {
        skip = Math.max(lineCount - 1, 0)
        matched = true
        break
      }
    }
    if (!matched)
      out.push(line)
  }
  return out.join('\n')
}
