import type { VectorStore } from '@pleaseai/soop-store/vector-store'
import type { Command } from 'commander'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { decideSyncFromCommitDiff } from '@pleaseai/soop-encoder/sync'
import { decodeAllEmbeddings, parseEmbeddings, parseEmbeddingsJsonl } from '@pleaseai/soop-graph/embeddings'
import { LocalVectorStore } from '@pleaseai/soop-store/local'
import { getCurrentBranch, getDefaultBranch, getHeadCommitSha, getMergeBase } from '@pleaseai/soop-utils/git-helpers'
import { createLogger } from '@pleaseai/soop-utils/logger'

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
    .option(
      '--staged-only',
      'Scope dirty-file detection to the git index (pre-commit hook semantic). Working-tree-but-not-staged changes are ignored.',
    )
    .action(
      async (options: { force?: boolean, stagedOnly?: boolean }) => {
        const repoPath = process.cwd()
        const repoDir = path.join(repoPath, '.soop')
        const canonicalPathJsonl = path.join(repoDir, 'graph.jsonl')
        const canonicalPathJson = path.join(repoDir, 'graph.json')
        const canonicalPath = existsSync(canonicalPathJsonl) ? canonicalPathJsonl : canonicalPathJson
        const isJsonl = canonicalPath.endsWith('.jsonl')
        const localDir = path.join(repoDir, 'local')
        const localGraphPath = path.join(localDir, isJsonl ? 'graph.jsonl' : 'graph.json')
        const localStatePath = path.join(localDir, 'state.json')

        // 1. Validate canonical graph exists
        if (!existsSync(canonicalPath)) {
          log.error('.soop/graph.json (or graph.jsonl) not found. Run "repo init --encode" first.')
          process.exit(1)
        }

        // 2. Ensure local directory exists
        await mkdir(path.join(localDir, 'vectors'), { recursive: true })

        let currentBranch: string
        let defaultBranch: string
        let headSha: string
        try {
          currentBranch = getCurrentBranch(repoPath)
          defaultBranch = getDefaultBranch(repoPath)
          headSha = getHeadCommitSha(repoPath)
        }
        catch (error) {
          const msg = error instanceof Error ? error.message : String(error)
          log.error(`Git operation failed: ${msg}. Ensure you are inside a git repository and git is installed.`)
          process.exit(1)
        }

        // 4. Read canonical graph + meta to get base commit
        const { RepositoryPlanningGraph } = await import('@pleaseai/soop-graph')
        const { metaPathFor, deserializeMeta, absorbLegacyGithubCommit } = await import('@pleaseai/soop-graph/meta')
        const canonicalContent = await readFile(canonicalPath, 'utf-8')
        let canonicalCommit: string | undefined
        let canonicalGitMeta: import('@pleaseai/soop-graph/meta').GitMeta | null = null
        try {
          const metaJson = await readFile(metaPathFor(canonicalPath), 'utf-8')
          const rawMeta = deserializeMeta(JSON.parse(metaJson))
          // Absorb legacy github.commit → git.headCommit during the transition window.
          const meta = absorbLegacyGithubCommit(rawMeta)
          canonicalCommit = meta.git?.headCommit ?? meta.github?.commit
          canonicalGitMeta = meta.git ?? null
        }
        catch (metaReadError) {
          log.debug(`Could not read canonical meta file, falling back to graph: ${metaReadError instanceof Error ? metaReadError.message : String(metaReadError)}`)
          // Fallback: load from graph (backward compat)
          const canonicalRpg = isJsonl
            ? await RepositoryPlanningGraph.fromJSONL(canonicalContent)
            : await RepositoryPlanningGraph.fromJSON(canonicalContent)
          canonicalCommit = canonicalRpg.getConfig().github?.commit
        }

        // Diagnostic: log the decision-tree assessment against the recorded
        // baseline. Doesn't drive the copy/evolve flow yet — informational
        // for users debugging sync behavior and a contract test point for
        // the pre-commit hook (which calls with --staged-only).
        const decision = decideSyncFromCommitDiff(
          repoPath,
          canonicalGitMeta,
          { forceFull: options.force, stagedOnly: options.stagedOnly },
        )
        log.info(
          `Sync decision: mode=${decision.mode} reason=${decision.reason} `
          + `last=${decision.lastCommit?.slice(0, 7) ?? 'none'} `
          + `current=${decision.currentCommit?.slice(0, 7) ?? 'none'} `
          + `changed=${decision.changed.length}`,
        )

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
          try {
            const canonicalMetaPath = metaPathFor(canonicalPath)
            if (existsSync(canonicalMetaPath))
              await copyFile(canonicalMetaPath, metaPathFor(localGraphPath))
          }
          catch (metaError) {
            log.debug(`Could not copy canonical meta file: ${metaError instanceof Error ? metaError.message : String(metaError)}`)
          }
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
            log.warn(`Could not compute merge-base with ${defaultBranch}: ${msg}. Falling back to canonical commit ${canonicalCommit} — evolve range may be larger than expected.`)
            mergeBase = canonicalCommit
          }

          if (mergeBase !== headSha) {
            const commitRange = `${mergeBase}..HEAD`
            log.start(`Evolving local graph: ${commitRange}`)

            try {
              const { RPGEncoder } = await import('@pleaseai/soop-encoder')
              const encoder = await RPGEncoder.fromSaved(localGraphPath, repoPath)
              const result = await encoder.evolve({ commitRange })

              await encoder.save(localGraphPath)
              log.success(
                `Local evolve: +${result.inserted} -${result.deleted} ~${result.modified} ⇆${result.rerouted}`,
              )
            }
            catch (error) {
              log.error('Local evolve failed', error)
              log.warn('Falling back to canonical graph copy. Local branch changes are NOT reflected in the local graph.')
              try {
                await copyFile(canonicalPath, localGraphPath)
                try {
                  const canonicalMetaPath = metaPathFor(canonicalPath)
                  if (existsSync(canonicalMetaPath))
                    await copyFile(canonicalMetaPath, metaPathFor(localGraphPath))
                }
                catch (metaError) {
                  log.debug(`Could not copy canonical meta file: ${metaError instanceof Error ? metaError.message : String(metaError)}`)
                }
              }
              catch (copyError) {
                log.error('Failed to copy canonical graph as fallback', copyError)
                process.exit(1)
              }
            }
          }
          else {
            log.info('Local graph is up to date')
          }
        }
        else if (!needsEvolve && !needsCopy) {
          // On default branch and not yet copied
          await copyFile(canonicalPath, localGraphPath)
          try {
            const canonicalMetaPath = metaPathFor(canonicalPath)
            if (existsSync(canonicalMetaPath))
              await copyFile(canonicalMetaPath, metaPathFor(localGraphPath))
          }
          catch (metaError) {
            log.debug(`Could not copy canonical meta file: ${metaError instanceof Error ? metaError.message : String(metaError)}`)
          }
          log.info('On default branch — synced canonical graph to local')
        }

        // 6. Load pre-computed embeddings into local vector DB if available
        let embeddingsLoaded = false
        const embeddingsPathJsonl = path.join(repoDir, 'embeddings.jsonl')
        const embeddingsPathJson = path.join(repoDir, 'embeddings.json')
        const embeddingsPath = existsSync(embeddingsPathJsonl) ? embeddingsPathJsonl : embeddingsPathJson
        if (existsSync(embeddingsPath)) {
          const vectorDbPath = path.join(localDir, 'vectors')
          const vectorStore: VectorStore = new LocalVectorStore()
          try {
            await vectorStore.open({ path: vectorDbPath })

            try {
              const embeddingsContent = await readFile(embeddingsPath, 'utf-8')
              const embeddings = embeddingsPath.endsWith('.jsonl')
                ? parseEmbeddingsJsonl(embeddingsContent)
                : parseEmbeddings(embeddingsContent)
              const vectors = decodeAllEmbeddings(embeddings)

              // Read the local RPG to get node metadata
              let localRpg: InstanceType<typeof RepositoryPlanningGraph> | undefined
              try {
                const localJson = await readFile(localGraphPath, 'utf-8')
                localRpg = isJsonl
                  ? await RepositoryPlanningGraph.fromJSONL(localJson)
                  : await RepositoryPlanningGraph.fromJSON(localJson)
                const nodes = await localRpg.getNodes()
                const nodeMap = new Map(nodes.map(n => [n.id, n]))

                const docs = [...vectors.entries()]
                  .filter(([id]) => nodeMap.has(id))
                  .map(([id, embedding]) => {
                    const node = nodeMap.get(id)!
                    return {
                      id,
                      embedding,
                      metadata: {
                        entityType: node.metadata?.entityType,
                        path: node.metadata?.path,
                        text: `${node.feature.description} ${(node.feature.keywords ?? []).join(' ')} ${node.metadata?.path ?? ''}`,
                      },
                    }
                  })

                if (docs.length > 0) {
                  try {
                    if (vectorStore.upsertBatch) {
                      await vectorStore.upsertBatch(docs)
                    }
                    else {
                      for (const doc of docs)
                        await vectorStore.upsert(doc.id, doc.embedding, doc.metadata)
                    }
                    log.success(`Pre-computed embeddings loaded: ${docs.length} vectors (${embeddings.config.model})`)
                    embeddingsLoaded = true
                  }
                  catch (upsertError) {
                    // Clear partial index to avoid inconsistent state
                    await vectorStore.clear?.()
                    throw upsertError
                  }
                }
              }
              finally {
                await localRpg?.close()
              }
            }
            catch (error) {
              log.warn(
                `Failed to load pre-computed embeddings: ${error instanceof Error ? error.message : String(error)}`,
              )
              log.warn('Falling back to on-demand embedding generation')
            }
          }
          finally {
            await vectorStore.close()
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
