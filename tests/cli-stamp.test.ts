import { mkdtempSync, rmSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { RepositoryPlanningGraph } from '@pleaseai/rpg-graph'
import { getHeadCommitSha } from '@pleaseai/rpg-utils/git-helpers'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

describe('stamp / last-commit logic', () => {
  let tempDir: string
  let rpgFile: string

  beforeEach(async () => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'rpg-test-'))
    rpgFile = path.join(tempDir, 'test.json')

    const rpg = await RepositoryPlanningGraph.create({
      name: 'test-repo',
      rootPath: process.cwd(),
    })
    await writeFile(rpgFile, await rpg.toJSON())
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('stamp should set config.github.commit to HEAD', async () => {
    const json = await readFile(rpgFile, 'utf-8')
    const rpg = await RepositoryPlanningGraph.fromJSON(json)
    const repoPath = rpg.getConfig().rootPath ?? '.'
    const headSha = getHeadCommitSha(path.resolve(repoPath))
    const currentConfig = rpg.getConfig()

    rpg.updateConfig({
      github: {
        owner: currentConfig.github?.owner ?? '',
        repo: currentConfig.github?.repo ?? currentConfig.name,
        commit: headSha,
        pathPrefix: currentConfig.github?.pathPrefix,
      },
    })

    await writeFile(rpgFile, await rpg.toJSON())

    // Verify persisted
    const json2 = await readFile(rpgFile, 'utf-8')
    const rpg2 = await RepositoryPlanningGraph.fromJSON(json2)
    expect(rpg2.getConfig().github?.commit).toBe(headSha)
    expect(headSha).toMatch(/^[0-9a-f]{40}$/)
  })

  it('last-commit should read the stamped commit', async () => {
    const rpg = await RepositoryPlanningGraph.create({
      name: 'test',
      rootPath: '.',
      github: { owner: 'a', repo: 'b', commit: 'abc123def456789012345678901234567890abcd' },
    })
    const json = await rpg.toJSON()
    const restored = await RepositoryPlanningGraph.fromJSON(json)
    const commit = restored.getConfig().github?.commit
    expect(commit).toBe('abc123def456789012345678901234567890abcd')
  })

  it('last-commit should be undefined if no commit stamp', async () => {
    const rpg = await RepositoryPlanningGraph.create({ name: 'test' })
    const commit = rpg.getConfig().github?.commit
    expect(commit).toBeUndefined()
  })
})
