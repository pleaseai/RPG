#!/usr/bin/env npx tsx
/**
 * Aggregate retrieval metrics from experiment results
 *
 * Scans results/{experiment}/{model}/{timestamp}/retrieval-* /run-* /metrics.json
 * and computes aggregate IR metrics with breakdown by difficulty and category.
 *
 * Usage: npx tsx scripts/aggregate-retrieval-metrics.ts [results-dir]
 *        Default results-dir: ./results
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

interface Metrics {
  id: string
  query: string
  difficulty: string
  category: string
  predicted: string[]
  expected: string[]
  accuracy_at_1: number
  accuracy_at_3: number
  accuracy_at_5: number
  accuracy_at_10: number
  mrr: number
  precision: number
  recall: number
}

interface AggregateMetrics {
  count: number
  mean_accuracy_at_1: number
  mean_accuracy_at_3: number
  mean_accuracy_at_5: number
  mean_accuracy_at_10: number
  mean_mrr: number
  mean_precision: number
  mean_recall: number
}

function mean(values: number[]): number {
  if (values.length === 0)
    return 0
  return values.reduce((a, b) => a + b, 0) / values.length
}

function aggregate(metrics: Metrics[]): AggregateMetrics {
  return {
    count: metrics.length,
    mean_accuracy_at_1: mean(metrics.map(m => m.accuracy_at_1)),
    mean_accuracy_at_3: mean(metrics.map(m => m.accuracy_at_3)),
    mean_accuracy_at_5: mean(metrics.map(m => m.accuracy_at_5)),
    mean_accuracy_at_10: mean(metrics.map(m => m.accuracy_at_10)),
    mean_mrr: mean(metrics.map(m => m.mrr)),
    mean_precision: mean(metrics.map(m => m.precision)),
    mean_recall: mean(metrics.map(m => m.recall)),
  }
}

function fmt(n: number): string {
  return `${(n * 100).toFixed(1)}%`
}

function fmtDec(n: number): string {
  return n.toFixed(3)
}

function collectMetrics(resultsDir: string): Map<string, Metrics[]> {
  const experimentMetrics = new Map<string, Metrics[]>()

  if (!existsSync(resultsDir)) {
    console.error(`Results directory not found: ${resultsDir}`)
    return experimentMetrics
  }

  // Scan: results/{experiment}/{model}/{timestamp}/retrieval-*/run-*/
  for (const experiment of readdirSync(resultsDir, { withFileTypes: true })) {
    if (!experiment.isDirectory())
      continue

    const expDir = join(resultsDir, experiment.name)
    for (const model of readdirSync(expDir, { withFileTypes: true })) {
      if (!model.isDirectory())
        continue

      const modelDir = join(expDir, model.name)
      for (const timestamp of readdirSync(modelDir, { withFileTypes: true })) {
        if (!timestamp.isDirectory())
          continue

        const tsDir = join(modelDir, timestamp.name)
        for (const evalDir of readdirSync(tsDir, { withFileTypes: true })) {
          if (!evalDir.isDirectory() || !evalDir.name.startsWith('retrieval-'))
            continue

          const evalPath = join(tsDir, evalDir.name)
          for (const runDir of readdirSync(evalPath, { withFileTypes: true })) {
            if (!runDir.isDirectory() || !runDir.name.startsWith('run-'))
              continue

            const metricsPath = join(evalPath, runDir.name, 'metrics.json')
            if (!existsSync(metricsPath))
              continue

            const metrics: Metrics = JSON.parse(readFileSync(metricsPath, 'utf-8'))
            const key = `${experiment.name}/${model.name}`
            if (!experimentMetrics.has(key)) {
              experimentMetrics.set(key, [])
            }
            experimentMetrics.get(key)!.push(metrics)
          }
        }
      }
    }
  }

  return experimentMetrics
}

function generateReport(experimentMetrics: Map<string, Metrics[]>): string {
  const lines: string[] = []
  lines.push('# Retrieval Evaluation Report')
  lines.push('')
  lines.push(`Generated: ${new Date().toISOString()}`)
  lines.push('')

  if (experimentMetrics.size === 0) {
    lines.push('No retrieval metrics found. Run experiments first:')
    lines.push('```')
    lines.push('npx @pleaseai/agent-eval cc-retrieval')
    lines.push('npx @pleaseai/agent-eval cc-rpg-retrieval')
    lines.push('```')
    return lines.join('\n')
  }

  // Overall comparison table
  lines.push('## Overall Results')
  lines.push('')
  lines.push(
    '| Experiment | N | Acc@1 | Acc@3 | Acc@5 | Acc@10 | MRR | Precision | Recall |',
  )
  lines.push(
    '|------------|---|-------|-------|-------|--------|-----|-----------|--------|',
  )

  for (const [key, metrics] of experimentMetrics) {
    const agg = aggregate(metrics)
    lines.push(
      `| ${key} | ${agg.count} | ${fmt(agg.mean_accuracy_at_1)} | ${fmt(agg.mean_accuracy_at_3)} | ${fmt(agg.mean_accuracy_at_5)} | ${fmt(agg.mean_accuracy_at_10)} | ${fmtDec(agg.mean_mrr)} | ${fmt(agg.mean_precision)} | ${fmt(agg.mean_recall)} |`,
    )
  }
  lines.push('')

  // Per-experiment breakdown
  for (const [key, metrics] of experimentMetrics) {
    lines.push(`## ${key}`)
    lines.push('')

    // By difficulty
    lines.push('### By Difficulty')
    lines.push('')
    lines.push('| Difficulty | N | Acc@1 | Acc@5 | MRR | Recall |')
    lines.push('|------------|---|-------|-------|-----|--------|')

    const byDifficulty = new Map<string, Metrics[]>()
    for (const m of metrics) {
      if (!byDifficulty.has(m.difficulty))
        byDifficulty.set(m.difficulty, [])
      byDifficulty.get(m.difficulty)!.push(m)
    }
    for (const [diff, group] of [...byDifficulty].sort()) {
      const agg = aggregate(group)
      lines.push(
        `| ${diff} | ${agg.count} | ${fmt(agg.mean_accuracy_at_1)} | ${fmt(agg.mean_accuracy_at_5)} | ${fmtDec(agg.mean_mrr)} | ${fmt(agg.mean_recall)} |`,
      )
    }
    lines.push('')

    // By category
    lines.push('### By Category')
    lines.push('')
    lines.push('| Category | N | Acc@1 | Acc@5 | MRR | Recall |')
    lines.push('|----------|---|-------|-------|-----|--------|')

    const byCategory = new Map<string, Metrics[]>()
    for (const m of metrics) {
      if (!byCategory.has(m.category))
        byCategory.set(m.category, [])
      byCategory.get(m.category)!.push(m)
    }
    for (const [cat, group] of [...byCategory].sort()) {
      const agg = aggregate(group)
      lines.push(
        `| ${cat} | ${agg.count} | ${fmt(agg.mean_accuracy_at_1)} | ${fmt(agg.mean_accuracy_at_5)} | ${fmtDec(agg.mean_mrr)} | ${fmt(agg.mean_recall)} |`,
      )
    }
    lines.push('')

    // Per-query detail
    lines.push('### Per-Query Results')
    lines.push('')
    lines.push('| ID | Query | Diff | Acc@1 | Acc@5 | MRR |')
    lines.push('|----|-------|------|-------|-------|-----|')

    for (const m of metrics.sort((a, b) => a.id.localeCompare(b.id))) {
      const shortQuery = m.query.length > 50 ? `${m.query.slice(0, 47)}...` : m.query
      lines.push(
        `| ${m.id} | ${shortQuery} | ${m.difficulty} | ${fmt(m.accuracy_at_1)} | ${fmt(m.accuracy_at_5)} | ${fmtDec(m.mrr)} |`,
      )
    }
    lines.push('')
  }

  return lines.join('\n')
}

function main() {
  const ROOT = dirname(import.meta.dirname)
  const resultsDir = process.argv[2] || join(ROOT, 'results')

  console.log(`Scanning results in: ${resultsDir}`)
  const experimentMetrics = collectMetrics(resultsDir)

  if (experimentMetrics.size === 0) {
    console.log('No retrieval metrics found.')
    return
  }

  for (const [key, metrics] of experimentMetrics) {
    const agg = aggregate(metrics)
    console.log(`\n${key} (${metrics.length} queries):`)
    console.log(`  Acc@1: ${fmt(agg.mean_accuracy_at_1)}  Acc@5: ${fmt(agg.mean_accuracy_at_5)}  MRR: ${fmtDec(agg.mean_mrr)}`)
    console.log(`  Precision: ${fmt(agg.mean_precision)}  Recall: ${fmt(agg.mean_recall)}`)
  }

  const report = generateReport(experimentMetrics)
  const reportPath = join(resultsDir, 'retrieval-report.md')
  mkdirSync(dirname(reportPath), { recursive: true })
  writeFileSync(reportPath, report)
  console.log(`\nReport written to: ${reportPath}`)
}

main()
