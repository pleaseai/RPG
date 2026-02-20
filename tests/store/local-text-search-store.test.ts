import { LocalTextSearchStore } from '@pleaseai/rpg-store/local'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

describe('LocalTextSearchStore', () => {
  let store: LocalTextSearchStore

  beforeEach(async () => {
    store = new LocalTextSearchStore()
    await store.open({})
  })

  afterEach(async () => {
    await store.close()
  })

  it('returns empty results when nothing indexed', async () => {
    const results = await store.search('hello')
    expect(results).toEqual([])
  })

  it('returns empty for empty query', async () => {
    await store.index('a', { desc: 'hello world' })
    const results = await store.search('')
    expect(results).toEqual([])
  })

  it('index / search basic matching', async () => {
    await store.index('doc1', { feature_desc: 'authentication service', path: 'src/auth.ts' })
    const results = await store.search('authentication')
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('doc1')
    expect(results[0].score).toBeGreaterThan(0)
  })

  it('search is case-insensitive', async () => {
    await store.index('doc1', { feature_desc: 'Authentication Service' })
    const results = await store.search('authentication')
    expect(results).toHaveLength(1)
  })

  it('search supports prefix matching', async () => {
    await store.index('doc1', { feature_desc: 'authentication token handler' })
    const results = await store.search('authen')
    expect(results).toHaveLength(1)
  })

  it('remove deletes from index', async () => {
    await store.index('doc1', { feature_desc: 'authentication service' })
    await store.remove('doc1')
    const results = await store.search('authentication')
    expect(results).toHaveLength(0)
  })

  it('re-indexing replaces existing document', async () => {
    await store.index('doc1', { feature_desc: 'authentication service' })
    await store.index('doc1', { feature_desc: 'database connector' })
    expect(await store.search('authentication')).toHaveLength(0)
    expect(await store.search('database')).toHaveLength(1)
  })

  it('results are sorted by score descending', async () => {
    await store.index('doc1', { feature_desc: 'auth auth auth' })
    await store.index('doc2', { feature_desc: 'auth module' })
    await store.index('doc3', { feature_desc: 'unrelated content' })

    const results = await store.search('auth')
    expect(results[0].score).toBeGreaterThanOrEqual(results[1].score)
    expect(results.map(r => r.id)).not.toContain('doc3')
  })

  it('topK limits result count', async () => {
    for (let i = 0; i < 10; i++) {
      await store.index(`doc${i}`, { feature_desc: `handler function ${i}` })
    }
    const results = await store.search('handler', { topK: 3 })
    expect(results).toHaveLength(3)
  })

  it('fields option restricts search to specified fields', async () => {
    await store.index('doc1', { feature_desc: 'user management', path: 'src/user.ts' })
    await store.index('doc2', { feature_desc: 'auth service', path: 'src/user-auth.ts' })

    // Search only in path field
    const byPath = await store.search('user', { fields: ['path'] })
    const ids = byPath.map(r => r.id)
    expect(ids).toContain('doc1')
    expect(ids).toContain('doc2')

    // Search only in feature_desc — doc2 should not match "user"
    const byDesc = await store.search('user', { fields: ['feature_desc'] })
    expect(byDesc.map(r => r.id)).toContain('doc1')
    expect(byDesc.map(r => r.id)).not.toContain('doc2')
  })

  it('indexBatch indexes multiple documents', async () => {
    await store.indexBatch!([
      { id: 'a', fields: { feature_desc: 'component renderer' } },
      { id: 'b', fields: { feature_desc: 'data fetcher' } },
      { id: 'c', fields: { feature_desc: 'event dispatcher' } },
    ])
    expect(await store.search('renderer')).toHaveLength(1)
    expect(await store.search('fetcher')).toHaveLength(1)
    expect((await store.search('renderer'))[0].id).toBe('a')
  })

  it('fields are returned in search results', async () => {
    await store.index('doc1', { feature_desc: 'authentication', path: 'src/auth.ts' })
    const results = await store.search('authentication')
    expect(results[0].fields).toEqual({ feature_desc: 'authentication', path: 'src/auth.ts' })
  })

  it('search with no matching term returns empty', async () => {
    await store.index('doc1', { feature_desc: 'data processing pipeline' })
    const results = await store.search('authentication')
    expect(results).toHaveLength(0)
  })
})
