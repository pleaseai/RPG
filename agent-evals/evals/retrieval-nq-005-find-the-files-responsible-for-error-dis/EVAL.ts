/**
 * Retrieval Accuracy Evaluation
 *
 * Measures whether the agent correctly identifies relevant source files
 * for a given natural-language query about the Next.js codebase.
 *
 * Reads the agent's output (answer.json) and compares against ground truth
 * (GROUND_TRUTH.json), computing standard IR metrics.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'

interface GroundTruth {
  id: string
  query: string
  expect: string[]
  difficulty: string
  category: string
}

function loadAnswer(): string[] {
  const answerPath = join(process.cwd(), 'answer.json')
  if (!existsSync(answerPath))
    return []

  const raw = readFileSync(answerPath, 'utf-8')
  const parsed = JSON.parse(raw)

  if (Array.isArray(parsed))
    return parsed.map(String)
  if (parsed && Array.isArray(parsed.files))
    return parsed.files.map(String)
  return []
}

function loadGroundTruth(): GroundTruth {
  const gtPath = join(process.cwd(), 'GROUND_TRUTH.json')
  return JSON.parse(readFileSync(gtPath, 'utf-8'))
}

function normalizePath(p: string): string {
  return p.replace(/^\.?\//, '').replace(/\/+/g, '/')
}

function accuracyAtK(predicted: string[], expected: Set<string>, k: number): number {
  const topK = predicted.slice(0, k).map(normalizePath)
  return topK.some(p => expected.has(p)) ? 1 : 0
}

function meanReciprocalRank(predicted: string[], expected: Set<string>): number {
  for (let i = 0; i < predicted.length; i++) {
    if (expected.has(normalizePath(predicted[i]))) {
      return 1 / (i + 1)
    }
  }
  return 0
}

function precision(predicted: string[], expected: Set<string>): number {
  if (predicted.length === 0)
    return 0
  const hits = predicted.filter(p => expected.has(normalizePath(p))).length
  return hits / predicted.length
}

function recall(predicted: string[], expected: Set<string>): number {
  if (expected.size === 0)
    return 0
  const hits = predicted.filter(p => expected.has(normalizePath(p))).length
  return hits / expected.size
}

test('answer.json exists and is a valid JSON array', () => {
  const answerPath = join(process.cwd(), 'answer.json')
  expect(existsSync(answerPath), 'Agent must create answer.json').toBe(true)

  const raw = readFileSync(answerPath, 'utf-8')
  const parsed = JSON.parse(raw)
  const files = Array.isArray(parsed) ? parsed : parsed?.files
  expect(Array.isArray(files), 'answer.json must contain an array of file paths').toBe(true)
  expect(files.length).toBeGreaterThan(0)
})

test('Accuracy@5 >= 1 (at least one correct file in top 5)', () => {
  const predicted = loadAnswer()
  const gt = loadGroundTruth()
  const expected = new Set(gt.expect.map(normalizePath))

  const acc5 = accuracyAtK(predicted, expected, 5)
  expect(acc5, `None of the top 5 predictions matched expected files: ${gt.expect.join(', ')}`).toBe(
    1,
  )
})

test('Compute and write retrieval metrics', () => {
  const predicted = loadAnswer()
  const gt = loadGroundTruth()
  const expected = new Set(gt.expect.map(normalizePath))

  const metrics = {
    id: gt.id,
    query: gt.query,
    difficulty: gt.difficulty,
    category: gt.category,
    predicted: predicted.slice(0, 10),
    expected: gt.expect,
    accuracy_at_1: accuracyAtK(predicted, expected, 1),
    accuracy_at_3: accuracyAtK(predicted, expected, 3),
    accuracy_at_5: accuracyAtK(predicted, expected, 5),
    accuracy_at_10: accuracyAtK(predicted, expected, 10),
    mrr: meanReciprocalRank(predicted, expected),
    precision: precision(predicted.slice(0, 10), expected),
    recall: recall(predicted.slice(0, 10), expected),
  }

  const metricsPath = join(process.cwd(), 'metrics.json')
  writeFileSync(metricsPath, JSON.stringify(metrics, null, 2))

  // Always passes -- metrics are informational
  expect(true).toBe(true)
})
