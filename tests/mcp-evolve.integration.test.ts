import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { RPGEncoder } from '@pleaseai/rpg-encoder/encoder'
import { executeEvolve } from '@pleaseai/rpg-mcp/tools'
import { resolveGitBinary } from '@pleaseai/rpg-utils/git-path'
import { describe, expect, it } from 'vitest'

const FIXTURE_REPO = resolve(__dirname, 'fixtures/superjson')

function hasGitAncestor(repoPath: string, ref: string): boolean {
  try {
    execFileSync(resolveGitBinary(), ['rev-parse', '--verify', ref], { cwd: repoPath, stdio: 'pipe' })
    return true
  }
  catch {
    return false
  }
}

describe('MCP rpg_evolve Integration', () => {
  it.skipIf(!hasGitAncestor(FIXTURE_REPO, 'HEAD~1'))(
    'should evolve an encoded RPG via executeEvolve',
    async () => {
      // Step 1: Encode the fixture repo to get an RPG with rootPath
      const encoder = new RPGEncoder(FIXTURE_REPO, {
        include: ['src/**/*.ts'],
        exclude: ['**/node_modules/**', '**/dist/**'],
        semantic: { useLLM: false },
      })

      const { rpg: encodedRpg } = await encoder.encode()
      const statsBefore = await encodedRpg.getStats()
      expect(statsBefore.nodeCount).toBeGreaterThan(0)

      // Step 2: Evolve through the MCP tool interface
      const result = await executeEvolve(encodedRpg, {
        commitRange: 'HEAD~1..HEAD',
        useLLM: false,
      })

      // Step 3: Verify EvolutionResult structure
      expect(result).toHaveProperty('inserted')
      expect(result).toHaveProperty('deleted')
      expect(result).toHaveProperty('modified')
      expect(result).toHaveProperty('rerouted')
      expect(result).toHaveProperty('prunedNodes')
      expect(result).toHaveProperty('duration')
      expect(result).toHaveProperty('llmCalls')
      expect(result).toHaveProperty('errors')

      expect(result.duration).toBeGreaterThan(0)
      expect(result.llmCalls).toBe(0)
      expect(result.errors).toEqual([])

      // Step 4: Verify graph integrity after evolution
      const statsAfter = await encodedRpg.getStats()
      expect(statsAfter.nodeCount).toBeGreaterThan(0)

      const edges = await encodedRpg.getEdges()
      expect(edges.length).toBeGreaterThan(0)
      for (const edge of edges) {
        expect(await encodedRpg.hasNode(edge.source)).toBe(true)
        expect(await encodedRpg.hasNode(edge.target)).toBe(true)
      }
    },
  )
})
