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
  /** Whether pre-computed embeddings were loaded */
  embeddingsLoaded?: boolean
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
          catch (error) {
            const msg = error instanceof Error ? error.message : String(error)
            log.warn(`Could not read/parse local state: ${msg}. Will rebuild.`)
          }
        }

        const isOnDefaultBranch = currentBranch === defaultBranch || currentBranch === ''
        const needsEvolve = !isOnDefaultBranch && canonicalCommit

        // Copy canonical to local if needed
        const needsCopy = options.force || !existsSync(localGraphPath) || !localState
          || (canonicalCommit && localState.baseCommit !== canonicalCommit)
        if (needsCopy) {
          await copyFile(canonicalPath, localGraphPath)
          log.info('Copied canonical graph → local')
        }

        if (needsEvolve && canonicalCommit) {
          // Calculate commit range from merge-base to HEAD
          let mergeBase: string
          try {
            mergeBase = getMergeBase(repoPath, defaultBranch, 'HEAD')
          }
          catch (error) {
            const msg = error instanceof Error ? error.message : String(error)
            log.warn(`Could not compute merge-base with ${defaultBranch}, using canonical commit`)
            log.debug(`merge-base error: ${msg}`)
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
              log.error(`Local evolve failed: ${error instanceof Error ? error.message : String(error)}`)
              log.warn('Falling back to canonical graph copy. Local branch changes are NOT reflected in the local graph.')
              await copyFile(canonicalPath, localGraphPath)
            }
          }
          else {
            log.info('Local graph is up to date')
          }
        }
        else if (!needsEvolve && !needsCopy) {
          // On default branch and not yet copied
          await copyFile(canonicalPath, localGraphPath)
          log.info('On default branch — synced canonical graph to local')
        }

        // 6. Load pre-computed embeddings into local vector DB if available
        let embeddingsLoaded = false
        const embeddingsPath = path.join(rpgDir, 'embeddings.json')
        if (existsSync(embeddingsPath)) {
          try {
            const { parseEmbeddings, decodeAllEmbeddings } = await import('@pleaseai/rpg-graph/embeddings')
            const embeddingsJson = await readFile(embeddingsPath, 'utf-8')
            const embeddings = parseEmbeddings(embeddingsJson)
            const vectors = decodeAllEmbeddings(embeddings)

            // Load into LanceDB vector store
            const { VectorStore } = await import('@pleaseai/rpg-utils/vector')
            const vectorDbPath = path.join(localDir, 'vectors')
            const vectorStore = new VectorStore({
              dbPath: vectorDbPath,
              tableName: 'rpg_nodes',
              dimension: embeddings.config.dimension,
            })

            // Read the local RPG to get node metadata for content field
            const localJson = await readFile(localGraphPath, 'utf-8')
            const localRpg = await RepositoryPlanningGraph.fromJSON(localJson)
            const nodes = await localRpg.getNodes()
            const nodeMap = new Map(nodes.map(n => [n.id, n]))

            const docs = Array.from(vectors.entries())
              .filter(([id]) => nodeMap.has(id))
              .map(([id, vector]) => {
                const node = nodeMap.get(id)!
                return {
                  id,
                  text: `${node.feature.description} ${(node.feature.keywords ?? []).join(' ')} ${node.metadata?.path ?? ''}`,
                  vector,
                  metadata: {
                    entityType: node.metadata?.entityType,
                    path: node.metadata?.path,
                  },
                }
              })

            if (docs.length > 0) {
              await vectorStore.add(docs)
              log.success(`Pre-computed embeddings loaded: ${docs.length} vectors (${embeddings.config.model})`)
              embeddingsLoaded = true
            }

            await vectorStore.close()
            await localRpg.close()
          }
          catch (error) {
            log.warn(
              `Failed to load pre-computed embeddings: ${error instanceof Error ? error.message : String(error)}`,
            )
            log.warn('Falling back to on-demand embedding generation')
          }
        }

        // 7. Update local state
        const newState: LocalState = {
          baseCommit: canonicalCommit ?? headSha,
          branch: currentBranch,
          lastSync: new Date().toISOString(),
          embeddingsLoaded,
        }
        await writeFile(localStatePath, JSON.stringify(newState, null, 2))

        log.success('Sync complete')
      },
    )
}
