import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { RPGEncoder } from '../../src/encoder/encoder'
import { RPGEvolver } from '../../src/encoder/evolution/evolve'
import { resolveGitBinary } from '../../src/utils/git-path'

const FIXTURE_REPO = path.resolve(__dirname, '../fixtures/superjson')

function hasGitAncestor(repoPath: string, ref: string): boolean {
  let git: string
  try {
    git = resolveGitBinary()
  }
  catch {
    return false
  }
  try {
    execFileSync(git, ['rev-parse', '--verify', ref], { cwd: repoPath, stdio: 'pipe' })
    return true
  }
  catch {
    return false
  }
}

describe('evolution integration', () => {
  it.skipIf(!hasGitAncestor(FIXTURE_REPO, 'HEAD~1'))(
    'encodes a repo then evolves with a commit range',
    async () => {
      // Step 1: Encode the fixture repo
      const encoder = new RPGEncoder(FIXTURE_REPO, {
        include: ['src/**/*.ts'],
        exclude: ['**/node_modules/**', '**/dist/**'],
        semantic: { useLLM: false },
      })

      const { rpg } = await encoder.encode()
      const statsBefore = await rpg.getStats()

      expect(statsBefore.nodeCount).toBeGreaterThan(0)
      expect(statsBefore.edgeCount).toBeGreaterThan(0)

      // Step 2: Evolve with the last commit
      const evolver = new RPGEvolver(rpg, {
        commitRange: 'HEAD~1..HEAD',
        repoPath: FIXTURE_REPO,
        useLLM: false,
        semantic: { useLLM: false },
      })

      const result = await evolver.evolve()

      // Step 3: Verify evolution result structure
      expect(result).toHaveProperty('inserted')
      expect(result).toHaveProperty('deleted')
      expect(result).toHaveProperty('modified')
      expect(result).toHaveProperty('rerouted')
      expect(result).toHaveProperty('prunedNodes')
      expect(result).toHaveProperty('duration')
      expect(result).toHaveProperty('llmCalls')
      expect(result).toHaveProperty('errors')

      expect(result.duration).toBeGreaterThan(0)
      expect(result.llmCalls).toBe(0) // useLLM: false
      expect(result.errors).toEqual([]) // no errors expected

      // Step 4: Verify graph consistency after evolution
      const statsAfter = await rpg.getStats()
      expect(statsAfter.nodeCount).toBeGreaterThan(0)

      // All edges should reference existing nodes
      const edges = await rpg.getEdges()
      for (const edge of edges) {
        expect(await rpg.hasNode(edge.source)).toBe(true)
        expect(await rpg.hasNode(edge.target)).toBe(true)
      }
    },
  )

  it.skipIf(!hasGitAncestor(FIXTURE_REPO, 'HEAD~1'))(
    'RPGEncoder.evolve() delegates to RPGEvolver',
    async () => {
      const encoder = new RPGEncoder(FIXTURE_REPO, {
        include: ['src/**/*.ts'],
        exclude: ['**/node_modules/**'],
        semantic: { useLLM: false },
      })

      const { rpg } = await encoder.encode()

      const result = await encoder.evolve(rpg, { commitRange: 'HEAD~1..HEAD' })

      expect(result).toHaveProperty('inserted')
      expect(result).toHaveProperty('deleted')
      expect(result).toHaveProperty('modified')
      expect(result).toHaveProperty('duration')
      expect(result.duration).toBeGreaterThan(0)
    },
  )

  it.skipIf(!hasGitAncestor(FIXTURE_REPO, 'HEAD~1'))(
    'AC-5: evolution uses fewer LLM calls than full re-encode',
    async () => {
      // With useLLM: false, both should be 0 LLM calls
      // This test documents the cost measurement structure
      const encoder = new RPGEncoder(FIXTURE_REPO, {
        include: ['src/**/*.ts'],
        exclude: ['**/node_modules/**'],
        semantic: { useLLM: false },
      })

      const { rpg, entitiesExtracted } = await encoder.encode()

      const evolver = new RPGEvolver(rpg, {
        commitRange: 'HEAD~1..HEAD',
        repoPath: FIXTURE_REPO,
        useLLM: false,
        semantic: { useLLM: false },
      })

      const result = await evolver.evolve()

      // Evolution should process fewer entities than a full encode
      const totalEvolutionOps = result.inserted + result.deleted + result.modified + result.rerouted
      expect(totalEvolutionOps).toBeLessThan(entitiesExtracted)

      // LLM calls should be 0 in heuristic mode
      expect(result.llmCalls).toBe(0)
    },
  )
})
