import { DiffParser } from '@pleaseai/rpg-encoder/evolution/diff-parser'
import { describe, expect, it } from 'vitest'

describe('diffParser.parseNameStatus', () => {
  const parser = new DiffParser('/tmp/test-repo')

  it('parses added files', () => {
    const result = parser.parseNameStatus('A\tsrc/new-file.ts')
    expect(result).toEqual([{ status: 'A', filePath: 'src/new-file.ts' }])
  })

  it('parses modified files', () => {
    const result = parser.parseNameStatus('M\tsrc/existing.ts')
    expect(result).toEqual([{ status: 'M', filePath: 'src/existing.ts' }])
  })

  it('parses deleted files', () => {
    const result = parser.parseNameStatus('D\tsrc/removed.ts')
    expect(result).toEqual([{ status: 'D', filePath: 'src/removed.ts' }])
  })

  it('parses multiple changes', () => {
    const output = ['A\tsrc/new.ts', 'M\tsrc/changed.ts', 'D\tsrc/removed.ts'].join('\n')

    const result = parser.parseNameStatus(output)
    expect(result).toHaveLength(3)
    expect(result[0]).toEqual({ status: 'A', filePath: 'src/new.ts' })
    expect(result[1]).toEqual({ status: 'M', filePath: 'src/changed.ts' })
    expect(result[2]).toEqual({ status: 'D', filePath: 'src/removed.ts' })
  })

  it('handles rename as delete + add', () => {
    const result = parser.parseNameStatus('R100\tsrc/old.ts\tsrc/new.ts')
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ status: 'D', filePath: 'src/old.ts' })
    expect(result[1]).toEqual({ status: 'A', filePath: 'src/new.ts' })
  })

  it('handles copy as add', () => {
    const result = parser.parseNameStatus('C100\tsrc/original.ts\tsrc/copy.ts')
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ status: 'A', filePath: 'src/copy.ts' })
  })

  it('skips empty lines', () => {
    const output = 'A\tsrc/new.ts\n\nM\tsrc/changed.ts\n'
    const result = parser.parseNameStatus(output)
    expect(result).toHaveLength(2)
  })

  it('skips malformed lines', () => {
    const result = parser.parseNameStatus('invalid line')
    expect(result).toHaveLength(0)
  })

  it('handles empty output', () => {
    const result = parser.parseNameStatus('')
    expect(result).toHaveLength(0)
  })
})
