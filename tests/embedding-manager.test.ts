import { MockEmbedding } from '@pleaseai/rpg-encoder/embedding'
import { EmbeddingManager } from '@pleaseai/rpg-encoder/embedding-manager'
import { RepositoryPlanningGraph } from '@pleaseai/rpg-graph'
import { base64Float16ToFloat32 } from '@pleaseai/rpg-graph/embeddings'
import { describe, expect, it } from 'vitest'

async function createTestRPG(): Promise<RepositoryPlanningGraph> {
  const rpg = await RepositoryPlanningGraph.create({ name: 'test-repo' })

  await rpg.addHighLevelNode({
    id: 'hl-auth',
    feature: { description: 'Authentication module', keywords: ['auth', 'login'] },
  })

  await rpg.addLowLevelNode({
    id: 'll-login',
    feature: { description: 'Handle user login', keywords: ['login', 'credentials'] },
    metadata: { entityType: 'function', path: 'src/auth/login.ts' },
  })

  await rpg.addLowLevelNode({
    id: 'll-logout',
    feature: { description: 'Handle user logout', keywords: ['logout', 'session'] },
    metadata: { entityType: 'function', path: 'src/auth/logout.ts' },
  })

  await rpg.addFunctionalEdge({ source: 'hl-auth', target: 'll-login' })
  await rpg.addFunctionalEdge({ source: 'hl-auth', target: 'll-logout' })

  return rpg
}

describe('embeddingManager', () => {
  it('indexAll generates embeddings for all nodes', async () => {
    const rpg = await createTestRPG()
    const embedding = new MockEmbedding(8)

    const manager = new EmbeddingManager(embedding, {
      provider: 'mock',
      model: 'mock-8d',
      dimension: 8,
    })

    const result = await manager.indexAll(rpg, 'abc123')

    expect(result.version).toBe('1.0.0')
    expect(result.config.provider).toBe('mock')
    expect(result.config.model).toBe('mock-8d')
    expect(result.commit).toBe('abc123')
    expect(result.embeddings).toHaveLength(3)

    // Verify each embedding has a valid base64 float16 vector
    for (const entry of result.embeddings) {
      const decoded = base64Float16ToFloat32(entry.vector, 8)
      expect(decoded).toHaveLength(8)
      // MockEmbedding produces unit vectors, so magnitude should be ~1
      const mag = Math.sqrt(decoded.reduce((s, v) => s + v * v, 0))
      expect(mag).toBeCloseTo(1.0, 1)
    }

    await rpg.close()
  })

  it('applyChanges handles incremental updates', async () => {
    const rpg = await createTestRPG()
    const embedding = new MockEmbedding(8)
    const manager = new EmbeddingManager(embedding, {
      provider: 'mock',
      model: 'mock-8d',
      dimension: 8,
    })

    // Initial index
    const initial = await manager.indexAll(rpg, 'commit-1')
    expect(initial.embeddings).toHaveLength(3)

    // Simulate: remove ll-logout, modify ll-login, add ll-register
    await rpg.addLowLevelNode({
      id: 'll-register',
      feature: { description: 'Handle user registration', keywords: ['register', 'signup'] },
      metadata: { entityType: 'function', path: 'src/auth/register.ts' },
    })

    const updated = await manager.applyChanges(initial, rpg, {
      added: ['ll-register'],
      removed: ['ll-logout'],
      modified: ['ll-login'],
    }, 'commit-2')

    expect(updated.commit).toBe('commit-2')
    // 3 initial - 1 removed - 1 modified (re-added) + 1 added + 1 modified = 3
    expect(updated.embeddings).toHaveLength(3)

    const ids = updated.embeddings.map(e => e.id)
    expect(ids).toContain('hl-auth')
    expect(ids).toContain('ll-login')
    expect(ids).toContain('ll-register')
    expect(ids).not.toContain('ll-logout')

    await rpg.close()
  })

  it('applyChanges skips missing nodes gracefully', async () => {
    const rpg = await createTestRPG()
    const embedding = new MockEmbedding(8)
    const manager = new EmbeddingManager(embedding, {
      provider: 'mock',
      model: 'mock-8d',
      dimension: 8,
    })

    const initial = await manager.indexAll(rpg, 'commit-1')

    // Try to add a node that doesn't exist in RPG
    const updated = await manager.applyChanges(initial, rpg, {
      added: ['ll-nonexistent'],
      removed: [],
      modified: [],
    }, 'commit-2')

    // Should keep existing + skip nonexistent
    expect(updated.embeddings).toHaveLength(3)

    await rpg.close()
  })
})
