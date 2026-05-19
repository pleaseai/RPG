import { RepositoryPlanningGraph } from '@pleaseai/soop-graph'
import {
  levenshteinDistance,
  rankNodes,
  scoreCandidate,
  similarityRatio,
  suggestNodes,
} from '@pleaseai/soop-graph/fuzzy'
import { beforeEach, describe, expect, it } from 'vitest'

describe('levenshteinDistance', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshteinDistance('abc', 'abc')).toBe(0)
  })

  it('returns length when one string is empty', () => {
    expect(levenshteinDistance('', 'hello')).toBe(5)
    expect(levenshteinDistance('hello', '')).toBe(5)
  })

  it('counts single substitution', () => {
    expect(levenshteinDistance('kitten', 'sitten')).toBe(1)
  })

  it('counts classic kitten/sitting case', () => {
    expect(levenshteinDistance('kitten', 'sitting')).toBe(3)
  })
})

describe('similarityRatio', () => {
  it('is 100 for identical strings', () => {
    expect(similarityRatio('abc', 'abc')).toBe(100)
  })

  it('is case-insensitive', () => {
    expect(similarityRatio('ABC', 'abc')).toBe(100)
  })

  it('returns lower scores for distant strings', () => {
    const low = similarityRatio('abc', 'xyz')
    expect(low).toBeLessThan(50)
  })
})

describe('scoreCandidate', () => {
  it('scores exact match as 100', () => {
    expect(scoreCandidate('hello', 'hello')).toBe(100)
  })

  it('scores prefix/suffix matches above plain substring', () => {
    const prefix = scoreCandidate('auth', 'authentication')
    const inside = scoreCandidate('hen', 'authentication')
    expect(prefix).toBeGreaterThan(inside)
  })

  it('scores substring above fuzzy match', () => {
    const sub = scoreCandidate('auth', 'do_auth_check')
    const fuzz = scoreCandidate('auht', 'authentication') // typo
    expect(sub).toBeGreaterThan(fuzz)
  })

  it('returns 0 when query or candidate is empty', () => {
    expect(scoreCandidate('', 'abc')).toBe(0)
    expect(scoreCandidate('abc', '')).toBe(0)
  })
})

describe('rankNodes + suggestNodes', () => {
  let rpg: RepositoryPlanningGraph

  beforeEach(async () => {
    rpg = await RepositoryPlanningGraph.create({ name: 'test-repo' })

    await rpg.addHighLevelNode({
      id: 'authentication-module',
      feature: { description: 'handle user authentication' },
      directoryPath: '/src/auth',
    })
    await rpg.addHighLevelNode({
      id: 'authorization-module',
      feature: { description: 'role-based access control' },
      directoryPath: '/src/authz',
    })
    await rpg.addLowLevelNode({
      id: 'login.ts',
      feature: { description: 'login entry point' },
      metadata: { entityType: 'file', path: '/src/auth/login.ts' },
    })
  })

  it('orders substring matches before fuzzy matches', async () => {
    const all = await rpg.getNodes()
    const ranked = rankNodes('auth', all)

    expect(ranked[0]?.score).toBeGreaterThanOrEqual(ranked[1]?.score ?? 0)
    // 'authentication-module' and 'authorization-module' both contain 'auth' as substring
    expect(ranked.slice(0, 2).map(r => r.id)).toEqual(
      expect.arrayContaining(['authentication-module', 'authorization-module']),
    )
  })

  it('returns suggestions for typo (fuzzy)', async () => {
    const suggestions = await suggestNodes(rpg, 'authentcation', { limit: 5 })

    expect(suggestions).toContain('authentication-module')
  })

  it('returns substring matches first for shared prefix', async () => {
    const suggestions = await suggestNodes(rpg, 'auth', { limit: 5 })

    // Both auth-* modules should come back; login.ts (no 'auth' in id) may also match via path
    expect(suggestions.length).toBeGreaterThanOrEqual(2)
    expect(suggestions).toContain('authentication-module')
    expect(suggestions).toContain('authorization-module')
  })

  it('respects the limit option', async () => {
    const suggestions = await suggestNodes(rpg, 'auth', { limit: 1 })

    expect(suggestions.length).toBe(1)
  })

  it('returns empty array for empty query', async () => {
    const suggestions = await suggestNodes(rpg, '   ', { limit: 5 })

    expect(suggestions).toEqual([])
  })

  it('respects scope by limiting to the subtree', async () => {
    await rpg.addFunctionalEdge({ source: 'authentication-module', target: 'login.ts' })

    const scoped = await suggestNodes(rpg, 'authoriz', {
      limit: 5,
      scope: 'authentication-module',
    })

    // authorization-module is outside the auth subtree, so it must not appear
    expect(scoped).not.toContain('authorization-module')
  })
})
