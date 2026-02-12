#!/usr/bin/env bun
/**
 * Encode Next.js packages/next into an RPG with LLM-based semantic extraction.
 *
 * Usage:
 *   bun run scripts/encode-nextjs.ts
 *
 * Requires one of: GOOGLE_API_KEY, ANTHROPIC_API_KEY, or OPENAI_API_KEY
 */
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { RPGEncoder } from '@pleaseai/rpg-encoder'

const REPO_PATH = path.resolve(import.meta.dirname, '..', 'tests/fixtures/nextjs/packages/next')
const OUTPUT_PATH = path.resolve(import.meta.dirname, '..', 'agent-evals/fixtures/nextjs-rpg.json')

async function main() {
  console.log(`Encoding: ${REPO_PATH}`)
  console.log(`Output:   ${OUTPUT_PATH}`)

  const encoder = new RPGEncoder(REPO_PATH, {
    include: ['**/*.ts', '**/*.tsx'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/__tests__/**', '**/test/**'],
    maxDepth: 10,
    semantic: {
      useLLM: true,
    },
  })

  const result = await encoder.encode()

  await writeFile(OUTPUT_PATH, await result.rpg.toJSON())

  const stats = await result.rpg.getStats()

  console.log('\nEncoding complete:')
  console.log(`  Files processed: ${result.filesProcessed}`)
  console.log(`  Entities extracted: ${result.entitiesExtracted}`)
  console.log(`  Duration: ${(result.duration / 1000).toFixed(1)}s`)
  console.log(`\nGraph statistics:`)
  console.log(`  Total nodes: ${stats.nodeCount}`)
  console.log(`    High-level (modules): ${stats.highLevelNodeCount}`)
  console.log(`    Low-level (entities): ${stats.lowLevelNodeCount}`)
  console.log(`  Total edges: ${stats.edgeCount}`)
  console.log(`    Functional: ${stats.functionalEdgeCount}`)
  console.log(`    Dependency: ${stats.dependencyEdgeCount}`)

  if (result.warnings?.length) {
    console.log(`\nWarnings (${result.warnings.length}):`)
    for (const w of result.warnings.slice(0, 10)) {
      console.log(`  - ${w}`)
    }
    if (result.warnings.length > 10) {
      console.log(`  ... and ${result.warnings.length - 10} more`)
    }
  }
}

main().catch((error) => {
  console.error('Fatal:', error)
  process.exit(1)
})
