import { RepositoryPlanningGraph } from '@pleaseai/rpg-graph'
import { describe, expect, it } from 'vitest'

describe('RepositoryPlanningGraph.updateConfig', () => {
  it('should update name', async () => {
    const rpg = await RepositoryPlanningGraph.create({ name: 'original' })
    rpg.updateConfig({ name: 'updated' })
    expect(rpg.getConfig().name).toBe('updated')
  })

  it('should update rootPath', async () => {
    const rpg = await RepositoryPlanningGraph.create({ name: 'test' })
    rpg.updateConfig({ rootPath: '/new/path' })
    expect(rpg.getConfig().rootPath).toBe('/new/path')
  })

  it('should update description', async () => {
    const rpg = await RepositoryPlanningGraph.create({ name: 'test' })
    rpg.updateConfig({ description: 'A test repo' })
    expect(rpg.getConfig().description).toBe('A test repo')
  })

  it('should update github config', async () => {
    const rpg = await RepositoryPlanningGraph.create({ name: 'test' })
    rpg.updateConfig({
      github: { owner: 'acme', repo: 'widget', commit: 'abc123' },
    })
    const cfg = rpg.getConfig()
    expect(cfg.github?.owner).toBe('acme')
    expect(cfg.github?.repo).toBe('widget')
    expect(cfg.github?.commit).toBe('abc123')
  })

  it('should preserve unchanged fields', async () => {
    const rpg = await RepositoryPlanningGraph.create({
      name: 'test',
      rootPath: '/keep',
      description: 'keep this',
    })
    rpg.updateConfig({ name: 'changed' })
    const cfg = rpg.getConfig()
    expect(cfg.name).toBe('changed')
    expect(cfg.rootPath).toBe('/keep')
    expect(cfg.description).toBe('keep this')
  })

  it('should persist commit stamp through serialization', async () => {
    const rpg = await RepositoryPlanningGraph.create({ name: 'test' })
    rpg.updateConfig({
      github: { owner: 'a', repo: 'b', commit: 'sha256hash' },
    })

    const json = await rpg.toJSON()
    const restored = await RepositoryPlanningGraph.fromJSON(json)
    expect(restored.getConfig().github?.commit).toBe('sha256hash')
  })
})
