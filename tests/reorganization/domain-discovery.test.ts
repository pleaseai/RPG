import type { FileFeatureGroup } from '@pleaseai/rpg-encoder/reorganization'
import { DomainDiscovery } from '@pleaseai/rpg-encoder/reorganization/domain-discovery'
import { describe, expect, it, vi } from 'vitest'

function createMockLLMClient(response: { functionalAreas: string[] }) {
  return {
    complete: vi.fn(),
    completeJSON: vi.fn().mockResolvedValue(response),
    getProvider: vi.fn().mockReturnValue('google'),
    getModel: vi.fn().mockReturnValue('test-model'),
  }
}

const sampleFileGroups: FileFeatureGroup[] = [
  {
    groupLabel: 'src/auth',
    fileFeatures: [
      {
        fileId: 'auth/login.ts:file',
        filePath: 'src/auth/login.ts',
        description: 'authenticate user credentials',
        keywords: ['auth', 'login'],
      },
      {
        fileId: 'auth/token.ts:file',
        filePath: 'src/auth/token.ts',
        description: 'manage JWT tokens',
        keywords: ['auth', 'token'],
      },
    ],
  },
  {
    groupLabel: 'src/db',
    fileFeatures: [
      {
        fileId: 'db/query.ts:file',
        filePath: 'src/db/query.ts',
        description: 'execute database queries',
        keywords: ['db', 'query'],
      },
    ],
  },
  {
    groupLabel: 'src/api',
    fileFeatures: [
      {
        fileId: 'api/routes.ts:file',
        filePath: 'src/api/routes.ts',
        description: 'define API routes',
        keywords: ['api', 'routes'],
      },
    ],
  },
]

describe('domainDiscovery', () => {
  it('returns correct PascalCase functional areas', async () => {
    const mockClient = createMockLLMClient({
      functionalAreas: ['Authentication', 'DataAccess', 'ApiManagement'],
    })

    const discovery = new DomainDiscovery(mockClient as any)
    const result = await discovery.discover(sampleFileGroups)

    expect(result.functionalAreas).toEqual(['Authentication', 'DataAccess', 'ApiManagement'])
    expect(mockClient.completeJSON).toHaveBeenCalledOnce()
  })

  it('normalizes non-PascalCase names', async () => {
    const mockClient = createMockLLMClient({
      functionalAreas: ['data processing', 'user_authentication', 'apiManagement'],
    })

    const discovery = new DomainDiscovery(mockClient as any)
    const result = await discovery.discover(sampleFileGroups)

    expect(result.functionalAreas).toEqual([
      'DataProcessing',
      'UserAuthentication',
      'ApiManagement',
    ])
  })

  it('deduplicates functional areas', async () => {
    const mockClient = createMockLLMClient({
      functionalAreas: ['Authentication', 'Authentication', 'DataAccess'],
    })

    const discovery = new DomainDiscovery(mockClient as any)
    const result = await discovery.discover(sampleFileGroups)

    expect(result.functionalAreas).toEqual(['Authentication', 'DataAccess'])
  })

  it('handles single functional area', async () => {
    const mockClient = createMockLLMClient({
      functionalAreas: ['CoreEngine'],
    })

    const singleGroup: FileFeatureGroup[] = [
      {
        groupLabel: 'src',
        fileFeatures: [
          {
            fileId: 'src/main.ts:file',
            filePath: 'src/main.ts',
            description: 'application entry point',
            keywords: ['main'],
          },
        ],
      },
    ]

    const discovery = new DomainDiscovery(mockClient as any)
    const result = await discovery.discover(singleGroup)

    expect(result.functionalAreas).toEqual(['CoreEngine'])
  })

  it('throws when LLM returns no valid areas', async () => {
    const mockClient = createMockLLMClient({
      functionalAreas: [],
    })

    const discovery = new DomainDiscovery(mockClient as any)
    await expect(discovery.discover(sampleFileGroups)).rejects.toThrow('no valid functional areas')
  })

  it('throws when LLM call fails', async () => {
    const mockClient = createMockLLMClient({ functionalAreas: [] })
    mockClient.completeJSON.mockRejectedValue(new Error('API rate limit'))

    const discovery = new DomainDiscovery(mockClient as any)
    await expect(discovery.discover(sampleFileGroups)).rejects.toThrow(
      'Domain Discovery LLM call failed',
    )
  })

  it('sanitizes non-alphanumeric characters in area names', async () => {
    const mockClient = createMockLLMClient({
      functionalAreas: ['Data/Processing', 'user.name', '___'],
    })

    const discovery = new DomainDiscovery(mockClient as any)
    const result = await discovery.discover(sampleFileGroups)

    // "Data/Processing" → "DataProcessing", "user.name" → "UserName", "___" → empty → filtered
    expect(result.functionalAreas).toEqual(['DataProcessing', 'UserName'])
  })

  it('filters out empty strings from areas', async () => {
    const mockClient = createMockLLMClient({
      functionalAreas: ['Authentication', '', '  ', 'DataAccess'],
    })

    const discovery = new DomainDiscovery(mockClient as any)
    const result = await discovery.discover(sampleFileGroups)

    expect(result.functionalAreas).toEqual(['Authentication', 'DataAccess'])
  })
})
