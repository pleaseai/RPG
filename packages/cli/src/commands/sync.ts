import type { Command } from 'commander'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createLogger } from '@pleaseai/rpg-utils/logger'

const log = createLogger('sync')

export interface LocalState {
  baseCommit: string
  branch: string
  lastSync: string
}

export function registerSyncCommand(program: Command): void {
  program
    .command('sync')
    .description('Sync canonical RPG to local with incremental evolve')
    .option('--force', 'Force full rebuild (ignore local state)')
    .action(
      async (options: { force?: boolean }) => {
        const repoPath = process.cwd()
        const rpgDir = path.join(repoPath, '.rpg')
        const canonicalPath = path.join(rpgDir, 'graph.json')
        const localDir = path.join(rpgDir, 'local')
        const localGraphPath = path.join(localDir, 'graph.json')
        const localStatePath = path.join(localDir, 'state.json')

        // 1. Validate canonical graph exists
        if (!existsSync(canonicalPath)) {
          log.error('.rpg/graph.json not found. Run "rpg init --encode" first.')
          process.exit(1)
        }

        // 2. Ensure local directory exists
        await mkdir(path.join(localDir, 'vectors'), { recursive: true })

        // 3. Import git helpers dynamically
        const { getCurrentBranch, getDefaultBranch, getHeadCommitSha, getMergeBase } = await import(
          '@pleaseai/rpg-utils/git-helpers',
        )

        const currentBranch = getCurrentBranch(repoPath)
        const defaultBranch = getDefaultBranch(repoPath)
        const headSha = getHeadCommitSha(repoPath)

        // 4. Read canonical graph to get base commit
        const { RepositoryPlanningGraph } = await import('@pleaseai/rpg-graph')
        const canonicalJson = await readFile(canonicalPath, 'utf-8')
        const canonicalRpg = await RepositoryPlanningGraph.fromJSON(canonicalJson)
        const canonicalCommit = canonicalRpg.getConfig().github?.commit

        // 5. Determine if we need to evolve
        let localState: LocalState | undefined
        if (!options.force && existsSync(localStatePath)) {
          try {
            localState = JSON.parse(await readFile(localStatePath, 'utf-8')) as LocalState
          }
          catch {
            log.warn('Could not parse local state, will rebuild')
          }
        }

        const isOnDefaultBranch = currentBranch === defaultBranch || currentBranch === ''
        const needsEvolve = !isOnDefaultBranch && canonicalCommit

        if (options.force || !existsSync(localGraphPath) || !localState) {
          // Full copy from canonical
          await copyFile(canonicalPath, localGraphPath)
          log.info('Copied canonical graph → local')
        }

        if (needsEvolve && canonicalCommit) {
          // Calculate commit range from merge-base to HEAD
          let mergeBase: string
          try {
            mergeBase = getMergeBase(repoPath, defaultBranch, 'HEAD')
          }
          catch {
            log.warn(`Could not compute merge-base with ${defaultBranch}, using canonical commit`)
            mergeBase = canonicalCommit
          }

          if (mergeBase !== headSha) {
            const commitRange = `${mergeBase}..HEAD`
            log.start(`Evolving local graph: ${commitRange}`)

            try {
              const localJson = await readFile(localGraphPath, 'utf-8')
              const localRpg = await RepositoryPlanningGraph.fromJSON(localJson)
              const { RPGEncoder } = await import('@pleaseai/rpg-encoder')
              const encoder = new RPGEncoder(repoPath)
              const result = await encoder.evolve(localRpg, { commitRange })

              await writeFile(localGraphPath, await localRpg.toJSON())
              log.success(
                `Local evolve: +${result.inserted} -${result.deleted} ~${result.modified} ⇆${result.rerouted}`,
              )
            }
            catch (error) {
              log.warn(`Local evolve failed: ${error instanceof Error ? error.message : String(error)}`)
              log.info('Falling back to canonical copy')
              await copyFile(canonicalPath, localGraphPath)
            }
          }
          else {
            log.info('Local graph is up to date')
          }
        }
        else if (!needsEvolve) {
          // On default branch, just copy
          await copyFile(canonicalPath, localGraphPath)
          log.info('On default branch — synced canonical graph to local')
        }

        // 6. Update local state
        const newState: LocalState = {
          baseCommit: canonicalCommit ?? headSha,
          branch: currentBranch,
          lastSync: new Date().toISOString(),
        }
        await writeFile(localStatePath, JSON.stringify(newState, null, 2))

        log.success('Sync complete')
      },
    )
}
