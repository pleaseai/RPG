import type { RepositoryPlanningGraph } from '@pleaseai/rpg-graph'
import path from 'node:path'
import { isHighLevelNode, isLowLevelNode } from '@pleaseai/rpg-graph/node'

class TrieNode {
  children = new Map<string, TrieNode>()
  isTerminal = false

  isBranching(): boolean {
    return this.children.size > 1
  }
}

// Prefix trie implementing COMPUTE_LCA from RPG-Encoder Algorithm 1 (Appendix A.1.3).
// Post-order traversal identifies branching/terminal nodes and prunes consolidated subtrees.
class PathTrie {
  private root = new TrieNode()

  insert(dirPath: string): void {
    const segments = dirPath.split('/').filter(s => s.length > 0)
    let current = this.root
    for (const segment of segments) {
      if (!current.children.has(segment)) {
        current.children.set(segment, new TrieNode())
      }
      current = current.children.get(segment)!
    }
    current.isTerminal = true
  }

  computeLCA(): string[] {
    const results: string[] = []
    this.postOrder(this.root, [], results)
    return results
  }

  private postOrder(node: TrieNode, pathSegments: string[], results: string[]): void {
    for (const [segment, child] of node.children) {
      this.postOrder(child, [...pathSegments, segment], results)
    }

    if (pathSegments.length === 0)
      return

    if (node.isBranching() || node.isTerminal) {
      const currentPath = pathSegments.join('/')
      const prefix = `${currentPath}/`
      for (let i = results.length - 1; i >= 0; i--) {
        if (results[i]!.startsWith(prefix)) {
          results.splice(i, 1)
        }
      }
      results.push(currentPath)
      node.children.clear()
      node.isTerminal = true
    }
  }
}

// Bottom-up LCA propagation for RPG HighLevelNodes (Algorithm 1, Appendix A.1.3).
// Assigns metadata.path by computing the LCA of leaf descendants' directory paths.
// Single-LCA: metadata.path only. Multi-LCA: first path + metadata.extra.paths.
export class ArtifactGrounder {
  constructor(private rpg: RepositoryPlanningGraph) {}

  async ground(): Promise<void> {
    const highLevelNodes = await this.rpg.getHighLevelNodes()
    const visited = new Set<string>()

    for (const node of highLevelNodes) {
      const parent = await this.rpg.getParent(node.id)
      if (!parent) {
        try {
          await this.propagate(node.id, visited)
        }
        catch (error) {
          console.warn(
            `[ArtifactGrounder] Failed to ground subtree rooted at "${node.id}": `
            + `${error instanceof Error ? error.message : String(error)}`,
          )
        }
      }
    }
  }

  private async propagate(nodeId: string, visited: Set<string>): Promise<Set<string>> {
    if (visited.has(nodeId))
      return new Set()
    visited.add(nodeId)
    const node = await this.rpg.getNode(nodeId)
    if (!node) {
      console.warn(`[ArtifactGrounder] Node "${nodeId}" not found, skipping subtree.`)
      return new Set()
    }

    if (isLowLevelNode(node)) {
      const filePath = node.metadata?.path
      if (!filePath) {
        console.warn(`[ArtifactGrounder] LowLevelNode "${nodeId}" has no metadata.path, skipping.`)
        return new Set()
      }
      return new Set([path.dirname(filePath).replace(/\\/g, '/')])
    }

    const children = await this.rpg.getChildren(nodeId)
    const dirSet = new Set<string>()

    const childDirSets = await Promise.all(children.map(child => this.propagate(child.id, visited)))
    for (const childDirs of childDirSets) {
      for (const dir of childDirs) {
        dirSet.add(dir)
      }
    }

    if (isHighLevelNode(node) && dirSet.size > 0) {
      const lcaPaths = computeLCA(dirSet)
      if (lcaPaths.length === 0)
        return dirSet
      const sorted = lcaPaths.length > 1 ? [...lcaPaths].sort() : lcaPaths
      const isMulti = sorted.length > 1

      await this.rpg.updateNode(nodeId, {
        metadata: {
          ...node.metadata,
          entityType: 'module',
          path: sorted[0],
          ...(isMulti && {
            extra: {
              ...node.metadata?.extra,
              paths: sorted,
            },
          }),
        },
      })
    }

    return dirSet
  }
}

export function computeLCA(dirPaths: Set<string>): string[] {
  if (dirPaths.size === 0)
    return []
  if (dirPaths.size === 1)
    return [...dirPaths]

  const trie = new PathTrie()
  for (const dir of dirPaths) {
    trie.insert(dir)
  }
  return trie.computeLCA()
}
