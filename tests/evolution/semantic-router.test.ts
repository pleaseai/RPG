import type { Embedding, EmbeddingResult } from '@pleaseai/rpg-encoder/embedding'
import type { LLMClient } from '@pleaseai/rpg-utils/llm'
import { cosineSimilarity, SemanticRouter } from '@pleaseai/rpg-encoder/evolution/semantic-router'
import { RepositoryPlanningGraph } from '@pleaseai/rpg-graph/rpg'
import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1)
    expect(cosineSimilarity([0.5, 0.5], [0.5, 0.5])).toBeCloseTo(1)
  })

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0)
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0)
  })

  it('returns -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1)
  })

  it('returns 0 for empty vectors', () => {
    expect(cosineSimilarity([], [])).toBe(0)
  })

  it('returns 0 for mismatched lengths', () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0)
  })

  it('returns 0 for zero vectors', () => {
    expect(cosineSimilarity([0, 0], [0, 0])).toBe(0)
  })

  it('computes correct similarity for non-trivial vectors', () => {
    // cos(45°) ≈ 0.707
    const a = [1, 0]
    const b = [1, 1]
    expect(cosineSimilarity(a, b)).toBeCloseTo(1 / Math.sqrt(2))
  })
})

describe('semanticRouter', () => {
  let rpg: RepositoryPlanningGraph

  beforeEach(async () => {
    rpg = await RepositoryPlanningGraph.create({ name: 'test' })

    // Build hierarchy: root → two abstract children
    await rpg.addHighLevelNode({
      id: 'dir:src/auth',
      feature: { description: 'authentication and authorization' },
      directoryPath: 'src/auth',
    })
    await rpg.addHighLevelNode({
      id: 'dir:src/db',
      feature: { description: 'database access and queries' },
      directoryPath: 'src/db',
    })
  })

  it('returns null when no high-level nodes exist', async () => {
    const emptyRpg = await RepositoryPlanningGraph.create({ name: 'empty' })
    const router = new SemanticRouter(emptyRpg)

    const result = await router.findBestParent('some feature')
    expect(result).toBeNull()
  })

  it('returns single root when only one exists', async () => {
    const singleRootRpg = await RepositoryPlanningGraph.create({ name: 'single' })
    await singleRootRpg.addHighLevelNode({
      id: 'dir:src',
      feature: { description: 'source code' },
      directoryPath: 'src',
    })

    const router = new SemanticRouter(singleRootRpg)
    const result = await router.findBestParent('some feature')
    expect(result).toBe('dir:src')
  })

  it('falls back to first candidate without LLM or embedding', async () => {
    const router = new SemanticRouter(rpg)
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const result = await router.findBestParent('user login logic')
    expect(result).toBeDefined()
    expect(typeof result).toBe('string')

    consoleSpy.mockRestore()
  })

  it('routes using embedding when provided', async () => {
    const mockEmbedding: Embedding = {
      embed: vi.fn(async (text: string): Promise<EmbeddingResult> => {
        // Return vectors that make "auth" closer to auth-related text
        if (text.includes('auth') || text.includes('login')) {
          return { vector: [1, 0, 0], model: 'test', dimension: 3 }
        }
        if (text.includes('database') || text.includes('query')) {
          return { vector: [0, 1, 0], model: 'test', dimension: 3 }
        }
        return { vector: [0.5, 0.5, 0], model: 'test', dimension: 3 }
      }),
    }

    const router = new SemanticRouter(rpg, { embedding: mockEmbedding })
    const result = await router.findBestParent('user login authentication')

    expect(result).toBe('dir:src/auth')
  })

  it('routes to database node for db-related features', async () => {
    const mockEmbedding: Embedding = {
      embed: vi.fn(async (text: string): Promise<EmbeddingResult> => {
        if (text.includes('auth') || text.includes('login')) {
          return { vector: [1, 0, 0], model: 'test', dimension: 3 }
        }
        if (text.includes('database') || text.includes('query')) {
          return { vector: [0, 1, 0], model: 'test', dimension: 3 }
        }
        return { vector: [0.5, 0.5, 0], model: 'test', dimension: 3 }
      }),
    }

    const router = new SemanticRouter(rpg, { embedding: mockEmbedding })
    const result = await router.findBestParent('database query optimization')

    expect(result).toBe('dir:src/db')
  })

  it('routes using LLM when provided', async () => {
    const mockLLM: LLMClient = {
      completeJSON: vi.fn(async () => ({
        selectedId: 'dir:src/auth',
        confidence: 0.9,
      })),
      complete: vi.fn(),
    }

    const router = new SemanticRouter(rpg, { llmClient: mockLLM })
    const result = await router.findBestParent('password hashing')

    expect(result).toBe('dir:src/auth')
    expect(router.getLLMCalls()).toBe(1)
  })

  it('falls back to embedding when LLM fails', async () => {
    const mockLLM: LLMClient = {
      completeJSON: vi.fn(async () => {
        throw new Error('API rate limited')
      }),
      complete: vi.fn(),
    }

    const mockEmbedding: Embedding = {
      embed: vi.fn(async (text: string): Promise<EmbeddingResult> => {
        if (text.includes('auth') || text.includes('password')) {
          return { vector: [1, 0, 0], model: 'test', dimension: 3 }
        }
        return { vector: [0, 1, 0], model: 'test', dimension: 3 }
      }),
    }

    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const router = new SemanticRouter(rpg, { llmClient: mockLLM, embedding: mockEmbedding })
    const result = await router.findBestParent('password hashing')

    expect(result).toBeDefined()
    expect(router.getLLMCalls()).toBe(1)
    consoleSpy.mockRestore()
  })

  it('returns null when LLM selects invalid candidate ID', async () => {
    const mockLLM: LLMClient = {
      completeJSON: vi.fn(async () => ({
        selectedId: 'dir:nonexistent',
        confidence: 0.8,
      })),
      complete: vi.fn(),
    }

    const router = new SemanticRouter(rpg, { llmClient: mockLLM })
    // With only 2 root candidates and LLM returning invalid ID, it returns null
    // which means the root-level selection returns null
    const result = await router.findBestParent('some feature')
    expect(result).toBeNull()
  })

  it('tracks and resets LLM call counter', async () => {
    const mockLLM: LLMClient = {
      completeJSON: vi.fn(async () => ({
        selectedId: 'dir:src/auth',
        confidence: 0.9,
      })),
      complete: vi.fn(),
    }

    const router = new SemanticRouter(rpg, { llmClient: mockLLM })
    expect(router.getLLMCalls()).toBe(0)

    await router.findBestParent('test')
    expect(router.getLLMCalls()).toBe(1)

    router.resetLLMCalls()
    expect(router.getLLMCalls()).toBe(0)
  })

  it('descends through hierarchy to find best parent', async () => {
    // Create a deeper hierarchy: root → auth → auth/providers
    await rpg.addHighLevelNode({
      id: 'dir:src/auth/providers',
      feature: { description: 'OAuth and SAML authentication providers' },
      directoryPath: 'src/auth/providers',
    })
    await rpg.addFunctionalEdge({ source: 'dir:src/auth', target: 'dir:src/auth/providers' })

    const mockEmbedding: Embedding = {
      embed: vi.fn(async (text: string): Promise<EmbeddingResult> => {
        if (text.includes('OAuth') || text.includes('provider')) {
          return { vector: [1, 0, 0], model: 'test', dimension: 3 }
        }
        if (text.includes('auth')) {
          return { vector: [0.8, 0.2, 0], model: 'test', dimension: 3 }
        }
        return { vector: [0, 1, 0], model: 'test', dimension: 3 }
      }),
    }

    const router = new SemanticRouter(rpg, { embedding: mockEmbedding })
    const result = await router.findBestParent('OAuth provider configuration')

    // Should descend past auth into auth/providers
    expect(result).toBe('dir:src/auth/providers')
  })
})
