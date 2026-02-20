import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RPGEncoder } from '@pleaseai/rpg-encoder'
import { MockEmbedding } from '@pleaseai/rpg-encoder/embedding'
import { SemanticSearch } from '@pleaseai/rpg-encoder/semantic-search'
import { RepositoryPlanningGraph } from '@pleaseai/rpg-graph'
import { LocalVectorStore } from '@pleaseai/rpg-store/local'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

describe('encoder Integration Tests', () => {
  let testDir: string

  beforeEach(async () => {
    testDir = join(tmpdir(), `rpg-integration-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(testDir, { recursive: true })
  })

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true })
    }
    catch {
      // Ignore cleanup errors
    }
  })

  describe('full Encoding Pipeline', () => {
    it('should encode a TypeScript project and produce valid RPG', async () => {
      // Create a simple TypeScript project
      await mkdir(join(testDir, 'src'), { recursive: true })

      await writeFile(
        join(testDir, 'src', 'index.ts'),
        `
import { greet } from './utils'

export function main(): void {
  console.log(greet('World'))
}
`,
      )

      await writeFile(
        join(testDir, 'src', 'utils.ts'),
        `
export function greet(name: string): string {
  return \`Hello, \${name}!\`
}

export class Greeter {
  private prefix: string

  constructor(prefix: string) {
    this.prefix = prefix
  }

  greet(name: string): string {
    return \`\${this.prefix}, \${name}!\`
  }
}
`,
      )

      // Encode the project
      const encoder = new RPGEncoder(testDir, {
        include: ['src/**/*.ts'],
        exclude: [],
      })

      const result = await encoder.encode()

      // Verify result
      expect(result.filesProcessed).toBe(2)
      expect(result.entitiesExtracted).toBeGreaterThan(2) // At least 2 files + functions/classes

      // Verify nodes
      const nodes = await result.rpg.getNodes()
      const fileNodes = nodes.filter(n => n.metadata?.entityType === 'file')
      expect(fileNodes.length).toBe(2)

      // Verify entities were extracted
      const functionNodes = nodes.filter(n => n.metadata?.entityType === 'function')
      const classNodes = nodes.filter(n => n.metadata?.entityType === 'class')
      expect(functionNodes.length).toBeGreaterThanOrEqual(2) // main, greet
      expect(classNodes.length).toBeGreaterThanOrEqual(1) // Greeter

      // Without LLM, semantic reorganization is skipped — no high-level nodes
      const highLevelNodes = await result.rpg.getHighLevelNodes()
      expect(highLevelNodes.length).toBe(0)

      // Verify dependency edges
      const dependencyEdges = await result.rpg.getDependencyEdges()
      // index.ts should have an import edge to utils.ts
      const importEdgeChecks = await Promise.all(
        dependencyEdges.map(async (e) => {
          const sourceNode = await result.rpg.getNode(e.source)
          const targetNode = await result.rpg.getNode(e.target)
          return (
            sourceNode?.metadata?.path?.includes('index.ts')
            && targetNode?.metadata?.path?.includes('utils.ts')
          )
        }),
      )
      const importEdge = dependencyEdges.find((_, i) => importEdgeChecks[i])
      expect(importEdge).toBeDefined()
    })

    it('should encode Python files correctly', async () => {
      await mkdir(join(testDir, 'src'), { recursive: true })

      await writeFile(
        join(testDir, 'src', 'main.py'),
        `
from utils import greet

def main():
    print(greet("World"))

if __name__ == "__main__":
    main()
`,
      )

      await writeFile(
        join(testDir, 'src', 'utils.py'),
        `
def greet(name: str) -> str:
    return f"Hello, {name}!"

class Greeter:
    def __init__(self, prefix: str):
        self.prefix = prefix

    def greet(self, name: str) -> str:
        return f"{self.prefix}, {name}!"
`,
      )

      const encoder = new RPGEncoder(testDir, {
        include: ['src/**/*.py'],
        exclude: [],
      })

      const result = await encoder.encode()

      expect(result.filesProcessed).toBe(2)

      // Verify Python entities were extracted
      const pyNodes = await result.rpg.getNodes()
      const fileNodes = pyNodes.filter(n => n.metadata?.entityType === 'file')
      expect(fileNodes.length).toBe(2)

      const functionNodes = pyNodes.filter(n => n.metadata?.entityType === 'function')
      expect(functionNodes.length).toBeGreaterThanOrEqual(2) // main, greet
    })
  })

  describe('RPG Serialization', () => {
    it('should serialize and deserialize RPG correctly', async () => {
      await mkdir(join(testDir, 'src'), { recursive: true })

      await writeFile(
        join(testDir, 'src', 'app.ts'),
        `
export function run(): void {
  console.log('Running')
}
`,
      )

      const encoder = new RPGEncoder(testDir, {
        include: ['src/**/*.ts'],
        exclude: [],
      })

      const result = await encoder.encode()

      // Serialize
      const json = await result.rpg.toJSON()

      // Deserialize
      const restored = await RepositoryPlanningGraph.fromJSON(json)

      // Verify
      expect(restored.getConfig().name).toBe(result.rpg.getConfig().name)
      expect((await restored.getNodes()).length).toBe((await result.rpg.getNodes()).length)
      expect((await restored.getFunctionalEdges()).length).toBe(
        (await result.rpg.getFunctionalEdges()).length,
      )

      // Verify node content is preserved
      for (const originalNode of await result.rpg.getNodes()) {
        const restoredNode = await restored.getNode(originalNode.id)
        expect(restoredNode).toBeDefined()
        expect(restoredNode?.feature.description).toBe(originalNode.feature.description)
        expect(restoredNode?.metadata?.entityType).toBe(originalNode.metadata?.entityType)
      }
    })
  })

  describe('semantic Search Integration', () => {
    let search: SemanticSearch
    let searchDbPath: string

    beforeEach(async () => {
      searchDbPath = join(testDir, 'search-db')
      const embedding = new MockEmbedding(64)
      const vectorStore = new LocalVectorStore()
      await vectorStore.open({ path: searchDbPath })
      search = new SemanticSearch({ vectorStore, embedding })
    })

    afterEach(async () => {
      await search.close()
    })

    it('should index encoded RPG nodes for semantic search', async () => {
      await mkdir(join(testDir, 'src'), { recursive: true })

      await writeFile(
        join(testDir, 'src', 'auth.ts'),
        `
export function login(username: string, password: string): boolean {
  // Validate credentials and return authentication result
  return true
}

export function logout(): void {
  // Clear user session
}
`,
      )

      await writeFile(
        join(testDir, 'src', 'database.ts'),
        `
export function connect(connectionString: string): void {
  // Establish database connection
}

export function query(sql: string): unknown[] {
  // Execute SQL query and return results
  return []
}
`,
      )

      // Encode the project
      const encoder = new RPGEncoder(testDir, {
        include: ['src/**/*.ts'],
        exclude: [],
      })

      const result = await encoder.encode()

      // Index all nodes in semantic search
      const nodes = await result.rpg.getNodes()
      const documents = nodes.map(node => ({
        id: node.id,
        content: node.feature.description,
        metadata: {
          entityType: node.metadata?.entityType,
          path: node.metadata?.path,
        },
      }))

      await search.indexBatch(documents)

      // Search for authentication-related entities
      const authResults = await search.search('user authentication login', 3)
      expect(authResults.length).toBeGreaterThan(0)

      // Search for database-related entities
      const dbResults = await search.search('database query connection', 3)
      expect(dbResults.length).toBeGreaterThan(0)

      // Verify we can find specific entities
      const count = await search.count()
      expect(count).toBe(nodes.length)
    })

    it('should find related nodes by semantic similarity', async () => {
      await mkdir(join(testDir, 'src'), { recursive: true })

      await writeFile(
        join(testDir, 'src', 'api.ts'),
        `
export function fetchUsers(): Promise<User[]> {
  // Retrieve all users from API
  return Promise.resolve([])
}

export function createUser(data: UserData): Promise<User> {
  // Create a new user via API
  return Promise.resolve({} as User)
}

export function updateUser(id: string, data: UserData): Promise<User> {
  // Update existing user
  return Promise.resolve({} as User)
}

export function deleteUser(id: string): Promise<void> {
  // Remove user from system
  return Promise.resolve()
}
`,
      )

      const encoder = new RPGEncoder(testDir, {
        include: ['src/**/*.ts'],
        exclude: [],
      })

      const result = await encoder.encode()

      // Index nodes
      const nodes = await result.rpg.getNodes()
      const documents = nodes.map(node => ({
        id: node.id,
        content: node.feature.description,
      }))

      await search.indexBatch(documents)

      // Search for CRUD operations
      const results = await search.search('user management operations', 5)

      // Should return multiple user-related results
      expect(results.length).toBeGreaterThan(0)
    })
  })

  describe('edge Cases', () => {
    it('should handle empty repository', async () => {
      const encoder = new RPGEncoder(testDir, {
        include: ['src/**/*.ts'],
        exclude: [],
      })

      const result = await encoder.encode()

      expect(result.filesProcessed).toBe(0)
      expect(result.entitiesExtracted).toBe(0)
      expect((await result.rpg.getNodes()).length).toBe(0)
    })

    it('should handle files with syntax errors gracefully', async () => {
      await mkdir(join(testDir, 'src'), { recursive: true })

      // Write file with syntax error
      await writeFile(
        join(testDir, 'src', 'broken.ts'),
        `
export function broken( {
  // Missing closing parenthesis
}
`,
      )

      const encoder = new RPGEncoder(testDir, {
        include: ['src/**/*.ts'],
        exclude: [],
      })

      // Should not throw, but may report fewer entities
      const result = await encoder.encode()
      expect(result.filesProcessed).toBe(1)
    })

    it('should handle deeply nested directories', async () => {
      const deepPath = join(testDir, 'a', 'b', 'c', 'd', 'e')
      await mkdir(deepPath, { recursive: true })

      await writeFile(
        join(deepPath, 'deep.ts'),
        `
export function deepFunction(): void {
  // Very deeply nested
}
`,
      )

      const encoder = new RPGEncoder(testDir, {
        include: ['**/*.ts'],
        exclude: [],
        maxDepth: 10,
      })

      const result = await encoder.encode()

      expect(result.filesProcessed).toBe(1)

      // Without LLM, semantic reorganization is skipped — no high-level nodes
      const highLevelNodes = await result.rpg.getHighLevelNodes()
      expect(highLevelNodes.length).toBe(0)
    })

    it('should respect maxDepth option', async () => {
      const deepPath = join(testDir, 'a', 'b', 'c', 'd', 'e')
      await mkdir(deepPath, { recursive: true })

      await writeFile(join(testDir, 'a', 'shallow.ts'), `export const shallow = true`)

      await writeFile(join(deepPath, 'deep.ts'), `export const deep = true`)

      const encoder = new RPGEncoder(testDir, {
        include: ['**/*.ts'],
        exclude: [],
        maxDepth: 2, // Only go 2 levels deep
      })

      const result = await encoder.encode()

      // Should only find the shallow file
      expect(result.filesProcessed).toBe(1)
    })
  })
})
