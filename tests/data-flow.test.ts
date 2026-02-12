import type { DataFlowEdge } from '@pleaseai/rpg-graph/edge'
import { DataFlowDetector } from '@pleaseai/rpg-encoder/data-flow'
import { describe, expect, it } from 'vitest'

describe('DataFlowDetector', () => {
  describe('constructor', () => {
    it('creates detector instance', () => {
      const detector = new DataFlowDetector({ repoPath: '/test/repo' })
      expect(detector).toBeDefined()
    })
  })

  describe('detectInterModuleFlows', () => {
    it('detects import-based data flow from module to module', () => {
      const detector = new DataFlowDetector({ repoPath: '/test/repo' })

      const fileA: Parameters<typeof detector.detectInterModuleFlows>[0][0] = {
        filePath: 'src/auth.ts',
        nodeId: 'src/auth.ts:file',
        parseResult: {
          language: 'typescript',
          entities: [],
          imports: [
            { module: './util', names: ['format', 'validate'] },
          ],
          errors: [],
        },
      }

      const fileB: Parameters<typeof detector.detectInterModuleFlows>[0][0] = {
        filePath: 'src/util.ts',
        nodeId: 'src/util.ts:file',
        parseResult: {
          language: 'typescript',
          entities: [
            { type: 'function', name: 'format', startLine: 1, endLine: 5, startColumn: 0, endColumn: 0 },
            { type: 'function', name: 'validate', startLine: 6, endLine: 10, startColumn: 0, endColumn: 0 },
          ],
          imports: [],
          errors: [],
        },
      }

      const flows = detector.detectInterModuleFlows([fileA, fileB])

      expect(flows).toHaveLength(2)
      expect(flows).toContainEqual({
        from: 'src/util.ts:file',
        to: 'src/auth.ts:file',
        dataId: 'format',
        dataType: 'import',
      })
      expect(flows).toContainEqual({
        from: 'src/util.ts:file',
        to: 'src/auth.ts:file',
        dataId: 'validate',
        dataType: 'import',
      })
    })

    it('handles multiple imports from same module', () => {
      const detector = new DataFlowDetector({ repoPath: '/test/repo' })

      const fileA: Parameters<typeof detector.detectInterModuleFlows>[0][0] = {
        filePath: 'src/main.ts',
        nodeId: 'src/main.ts:file',
        parseResult: {
          language: 'typescript',
          entities: [],
          imports: [
            { module: './helpers', names: ['foo', 'bar', 'baz'] },
          ],
          errors: [],
        },
      }

      const fileB: Parameters<typeof detector.detectInterModuleFlows>[0][0] = {
        filePath: 'src/helpers.ts',
        nodeId: 'src/helpers.ts:file',
        parseResult: {
          language: 'typescript',
          entities: [
            { type: 'function', name: 'foo', startLine: 1, endLine: 3, startColumn: 0, endColumn: 0 },
            { type: 'function', name: 'bar', startLine: 4, endLine: 6, startColumn: 0, endColumn: 0 },
            { type: 'function', name: 'baz', startLine: 7, endLine: 9, startColumn: 0, endColumn: 0 },
          ],
          imports: [],
          errors: [],
        },
      }

      const flows = detector.detectInterModuleFlows([fileA, fileB])

      expect(flows).toHaveLength(3)
      expect(flows.map(f => f.dataId).sort()).toEqual(['bar', 'baz', 'foo'])
    })

    it('returns empty result for files with no imports', () => {
      const detector = new DataFlowDetector({ repoPath: '/test/repo' })

      const file: Parameters<typeof detector.detectInterModuleFlows>[0][0] = {
        filePath: 'src/standalone.ts',
        nodeId: 'src/standalone.ts:file',
        parseResult: {
          language: 'typescript',
          entities: [
            { type: 'function', name: 'doSomething', startLine: 1, endLine: 5, startColumn: 0, endColumn: 0 },
          ],
          imports: [],
          errors: [],
        },
      }

      const flows = detector.detectInterModuleFlows([file])

      expect(flows).toEqual([])
    })

    it('skips external module imports (not starting with .)', () => {
      const detector = new DataFlowDetector({ repoPath: '/test/repo' })

      const file: Parameters<typeof detector.detectInterModuleFlows>[0][0] = {
        filePath: 'src/app.ts',
        nodeId: 'src/app.ts:file',
        parseResult: {
          language: 'typescript',
          entities: [],
          imports: [
            { module: 'express', names: ['Router'] },
            { module: 'lodash', names: ['map'] },
            { module: './local', names: ['helper'] },
          ],
          errors: [],
        },
      }

      const file2: Parameters<typeof detector.detectInterModuleFlows>[0][0] = {
        filePath: 'src/local.ts',
        nodeId: 'src/local.ts:file',
        parseResult: {
          language: 'typescript',
          entities: [
            { type: 'function', name: 'helper', startLine: 1, endLine: 3, startColumn: 0, endColumn: 0 },
          ],
          imports: [],
          errors: [],
        },
      }

      const flows = detector.detectInterModuleFlows([file, file2])

      expect(flows).toHaveLength(1)
      expect(flows[0].dataId).toBe('helper')
    })

    it('handles relative paths with different patterns', () => {
      const detector = new DataFlowDetector({ repoPath: '/test/repo' })

      const fileA: Parameters<typeof detector.detectInterModuleFlows>[0][0] = {
        filePath: 'src/api/routes.ts',
        nodeId: 'src/api/routes.ts:file',
        parseResult: {
          language: 'typescript',
          entities: [],
          imports: [
            { module: '../utils', names: ['logger'] },
            { module: './handlers', names: ['getUser'] },
          ],
          errors: [],
        },
      }

      const fileUtils: Parameters<typeof detector.detectInterModuleFlows>[0][0] = {
        filePath: 'src/utils.ts',
        nodeId: 'src/utils.ts:file',
        parseResult: {
          language: 'typescript',
          entities: [
            { type: 'function', name: 'logger', startLine: 1, endLine: 3, startColumn: 0, endColumn: 0 },
          ],
          imports: [],
          errors: [],
        },
      }

      const fileHandlers: Parameters<typeof detector.detectInterModuleFlows>[0][0] = {
        filePath: 'src/api/handlers.ts',
        nodeId: 'src/api/handlers.ts:file',
        parseResult: {
          language: 'typescript',
          entities: [
            { type: 'function', name: 'getUser', startLine: 1, endLine: 10, startColumn: 0, endColumn: 0 },
          ],
          imports: [],
          errors: [],
        },
      }

      const flows = detector.detectInterModuleFlows([fileA, fileUtils, fileHandlers])

      expect(flows).toHaveLength(2)
      expect(flows.map(f => f.dataId).sort()).toEqual(['getUser', 'logger'])
    })
  })

  describe('detectIntraModuleFlows', () => {
    it('detects variable chain data flow within module', () => {
      const detector = new DataFlowDetector({ repoPath: '/test/repo' })

      const source = `
function add(a: number, b: number): number {
  return a + b
}

function process(x: number): number {
  const result = add(x, 5)
  return result * 2
}
`

      const file: Parameters<typeof detector.detectIntraModuleFlows>[0] = {
        filePath: 'src/math.ts',
        nodeId: 'src/math.ts:file',
        parseResult: {
          language: 'typescript',
          entities: [
            { type: 'function', name: 'add', startLine: 2, endLine: 4, startColumn: 0, endColumn: 0, parameters: ['a', 'b'] },
            { type: 'function', name: 'process', startLine: 6, endLine: 9, startColumn: 0, endColumn: 0, parameters: ['x'] },
          ],
          imports: [],
          errors: [],
        },
        sourceCode: source,
      }

      const flows = detector.detectIntraModuleFlows(file)

      expect(flows.length).toBeGreaterThan(0)
      const variableFlows = flows.filter(f => f.dataId === 'result')
      expect(variableFlows.length).toBeGreaterThan(0)
    })

    it('handles files with no function calls', () => {
      const detector = new DataFlowDetector({ repoPath: '/test/repo' })

      const source = `
const API_KEY = 'secret'
const BASE_URL = 'https://api.example.com'
`

      const file: Parameters<typeof detector.detectIntraModuleFlows>[0] = {
        filePath: 'src/config.ts',
        nodeId: 'src/config.ts:file',
        parseResult: {
          language: 'typescript',
          entities: [
            { type: 'variable', name: 'API_KEY', startLine: 2, endLine: 2, startColumn: 0, endColumn: 0 },
            { type: 'variable', name: 'BASE_URL', startLine: 3, endLine: 3, startColumn: 0, endColumn: 0 },
          ],
          imports: [],
          errors: [],
        },
        sourceCode: source,
      }

      const flows = detector.detectIntraModuleFlows(file)

      expect(flows).toEqual([])
    })

    it('detects parameter forwarding between functions', () => {
      const detector = new DataFlowDetector({ repoPath: '/test/repo' })

      const source = `
function validate(input: string): boolean {
  return input.length > 0
}

function process(data: string): void {
  if (validate(data)) {
    console.log('Valid')
  }
}
`

      const file: Parameters<typeof detector.detectIntraModuleFlows>[0] = {
        filePath: 'src/processor.ts',
        nodeId: 'src/processor.ts:file',
        parseResult: {
          language: 'typescript',
          entities: [
            { type: 'function', name: 'validate', startLine: 2, endLine: 4, startColumn: 0, endColumn: 0, parameters: ['input'] },
            { type: 'function', name: 'process', startLine: 6, endLine: 10, startColumn: 0, endColumn: 0, parameters: ['data'] },
          ],
          imports: [],
          errors: [],
        },
        sourceCode: source,
      }

      const flows = detector.detectIntraModuleFlows(file)

      expect(flows.length).toBeGreaterThan(0)
      expect(flows.some(f => f.dataId === 'data')).toBe(true)
    })
  })

  describe('detectAll', () => {
    it('combines inter-module and intra-module flows', () => {
      const detector = new DataFlowDetector({ repoPath: '/test/repo' })

      const utilSource = `
export function add(a: number, b: number): number {
  return a + b
}
`

      const appSource = `
import { add } from './util'

function calculate(x: number): number {
  const sum = add(x, 10)
  return sum * 2
}
`

      const fileUtil: Parameters<typeof detector.detectAll>[0][0] = {
        filePath: 'src/util.ts',
        nodeId: 'src/util.ts:file',
        parseResult: {
          language: 'typescript',
          entities: [
            { type: 'function', name: 'add', startLine: 2, endLine: 4, startColumn: 0, endColumn: 0, parameters: ['a', 'b'] },
          ],
          imports: [],
          errors: [],
        },
        sourceCode: utilSource,
      }

      const fileApp: Parameters<typeof detector.detectAll>[0][0] = {
        filePath: 'src/app.ts',
        nodeId: 'src/app.ts:file',
        parseResult: {
          language: 'typescript',
          entities: [
            { type: 'function', name: 'calculate', startLine: 4, endLine: 7, startColumn: 0, endColumn: 0, parameters: ['x'] },
          ],
          imports: [
            { module: './util', names: ['add'] },
          ],
          errors: [],
        },
        sourceCode: appSource,
      }

      const flows = detector.detectAll([fileUtil, fileApp])

      // Should have inter-module flow (import-based)
      const interModuleFlows = flows.filter(f => f.dataType === 'import')
      expect(interModuleFlows.length).toBeGreaterThan(0)

      // Should have intra-module flows
      expect(flows.length).toBeGreaterThan(interModuleFlows.length)
    })

    it('returns empty array when no flows detected', () => {
      const detector = new DataFlowDetector({ repoPath: '/test/repo' })

      const file: Parameters<typeof detector.detectAll>[0][0] = {
        filePath: 'src/empty.ts',
        nodeId: 'src/empty.ts:file',
        parseResult: {
          language: 'typescript',
          entities: [],
          imports: [],
          errors: [],
        },
      }

      const flows = detector.detectAll([file])

      expect(flows).toEqual([])
    })

    it('returns valid DataFlowEdge objects that pass schema validation', () => {
      const detector = new DataFlowDetector({ repoPath: '/test/repo' })

      const file: Parameters<typeof detector.detectAll>[0][0] = {
        filePath: 'src/test.ts',
        nodeId: 'src/test.ts:file',
        parseResult: {
          language: 'typescript',
          entities: [
            { type: 'function', name: 'foo', startLine: 1, endLine: 3, startColumn: 0, endColumn: 0 },
          ],
          imports: [
            { module: './helper', names: ['util'] },
          ],
          errors: [],
        },
      }

      const helper: Parameters<typeof detector.detectAll>[0][0] = {
        filePath: 'src/helper.ts',
        nodeId: 'src/helper.ts:file',
        parseResult: {
          language: 'typescript',
          entities: [
            { type: 'function', name: 'util', startLine: 1, endLine: 5, startColumn: 0, endColumn: 0 },
          ],
          imports: [],
          errors: [],
        },
      }

      const flows = detector.detectAll([file, helper])
      expect(flows.length).toBeGreaterThan(0)

      // All flows should have required fields
      flows.forEach((flow: DataFlowEdge) => {
        expect(flow.from).toBeDefined()
        expect(flow.to).toBeDefined()
        expect(flow.dataId).toBeDefined()
        expect(flow.dataType).toBeDefined()
        expect(typeof flow.from).toBe('string')
        expect(typeof flow.to).toBe('string')
        expect(typeof flow.dataId).toBe('string')
        expect(typeof flow.dataType).toBe('string')
      })
    })
  })
})
