#!/usr/bin/env npx tsx
/**
 * Generate retrieval eval directories from nextjs-queries.json
 *
 * Each query becomes its own eval directory under evals/retrieval-{id}-{slug}/
 * with PROMPT.md, EVAL.ts, GROUND_TRUTH.json, and package.json.
 *
 * Usage: npx tsx scripts/generate-retrieval-evals.ts
 */

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

interface Query {
  id: string
  query: string
  expect: string[]
  difficulty: string
  category: string
}

const ROOT = dirname(import.meta.dirname)
const QUERIES_PATH = join(ROOT, 'fixtures', 'nextjs-queries.json')
const TEMPLATE_DIR = join(ROOT, 'evals', '_templates', 'retrieval')
const EVALS_DIR = join(ROOT, 'evals')

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
    .replace(/-$/, '')
}

function main() {
  if (!existsSync(QUERIES_PATH)) {
    console.error(`Missing queries file: ${QUERIES_PATH}`)
    process.exit(1)
  }
  if (!existsSync(TEMPLATE_DIR)) {
    console.error(`Missing template directory: ${TEMPLATE_DIR}`)
    process.exit(1)
  }

  const queries: Query[] = JSON.parse(readFileSync(QUERIES_PATH, 'utf-8'))
  const promptTemplate = readFileSync(join(TEMPLATE_DIR, 'PROMPT.md'), 'utf-8')

  let created = 0

  for (const q of queries) {
    const slug = slugify(q.query)
    const dirName = `retrieval-${q.id}-${slug}`
    const evalDir = join(EVALS_DIR, dirName)

    // Clean existing directory
    if (existsSync(evalDir)) {
      rmSync(evalDir, { recursive: true })
    }
    mkdirSync(evalDir, { recursive: true })

    // Write PROMPT.md with query baked in
    const prompt = promptTemplate.replace('{{QUERY}}', q.query)
    writeFileSync(join(evalDir, 'PROMPT.md'), prompt)

    // Copy EVAL.ts from template
    cpSync(join(TEMPLATE_DIR, 'EVAL.ts'), join(evalDir, 'EVAL.ts'))

    // Copy package.json from template
    cpSync(join(TEMPLATE_DIR, 'package.json'), join(evalDir, 'package.json'))

    // Write GROUND_TRUTH.json
    writeFileSync(
      join(evalDir, 'GROUND_TRUTH.json'),
      JSON.stringify(
        {
          id: q.id,
          query: q.query,
          expect: q.expect,
          difficulty: q.difficulty,
          category: q.category,
        },
        null,
        2,
      ),
    )

    console.log(`  Created ${dirName}`)
    created++
  }

  console.log(`\nGenerated ${created} retrieval eval directories`)
}

main()
