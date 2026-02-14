import { execSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

describe('CLI batch options', () => {
  describe('encode command', () => {
    it('should show --min-batch-tokens option in help', () => {
      const output = execSync('bun run packages/cli/src/cli.ts encode --help', {
        encoding: 'utf-8',
        cwd: '/home/coder/IdeaProjects/rpg',
      })
      expect(output).toContain('--min-batch-tokens')
    })

    it('should show --max-batch-tokens option in help', () => {
      const output = execSync('bun run packages/cli/src/cli.ts encode --help', {
        encoding: 'utf-8',
        cwd: '/home/coder/IdeaProjects/rpg',
      })
      expect(output).toContain('--max-batch-tokens')
    })

    it('should describe min-batch-tokens with tokens parameter', () => {
      const output = execSync('bun run packages/cli/src/cli.ts encode --help', {
        encoding: 'utf-8',
        cwd: '/home/coder/IdeaProjects/rpg',
      })
      expect(output).toMatch(/--min-batch-tokens.*tokens/i)
    })

    it('should describe max-batch-tokens with tokens parameter', () => {
      const output = execSync('bun run packages/cli/src/cli.ts encode --help', {
        encoding: 'utf-8',
        cwd: '/home/coder/IdeaProjects/rpg',
      })
      expect(output).toMatch(/--max-batch-tokens.*tokens/i)
    })
  })

  describe('evolve command', () => {
    it('should show --min-batch-tokens option in help', () => {
      const output = execSync('bun run packages/cli/src/cli.ts evolve --help', {
        encoding: 'utf-8',
        cwd: '/home/coder/IdeaProjects/rpg',
      })
      expect(output).toContain('--min-batch-tokens')
    })

    it('should show --max-batch-tokens option in help', () => {
      const output = execSync('bun run packages/cli/src/cli.ts evolve --help', {
        encoding: 'utf-8',
        cwd: '/home/coder/IdeaProjects/rpg',
      })
      expect(output).toContain('--max-batch-tokens')
    })

    it('should describe min-batch-tokens with tokens parameter', () => {
      const output = execSync('bun run packages/cli/src/cli.ts evolve --help', {
        encoding: 'utf-8',
        cwd: '/home/coder/IdeaProjects/rpg',
      })
      expect(output).toMatch(/--min-batch-tokens.*tokens/i)
    })

    it('should describe max-batch-tokens with tokens parameter', () => {
      const output = execSync('bun run packages/cli/src/cli.ts evolve --help', {
        encoding: 'utf-8',
        cwd: '/home/coder/IdeaProjects/rpg',
      })
      expect(output).toMatch(/--max-batch-tokens.*tokens/i)
    })
  })
})
