import { describe, expect, it } from 'vitest'
import { parseNameStatus } from '../../src/git/name-status'

describe('parseNameStatus', () => {
  it('returns empty result for empty input', () => {
    expect(parseNameStatus('')).toEqual({ modified: [], renames: {} })
    expect(parseNameStatus(null)).toEqual({ modified: [], renames: {} })
    expect(parseNameStatus(undefined)).toEqual({ modified: [], renames: {} })
  })

  it('parses A/D/M lines into modified', () => {
    const raw = 'A\tsrc/new.ts\nD\tsrc/old.ts\nM\tsrc/changed.ts'
    const result = parseNameStatus(raw)
    expect(result.modified).toEqual(['src/new.ts', 'src/old.ts', 'src/changed.ts'])
    expect(result.renames).toEqual({})
  })

  it('parses R<score> lines into renames and adds new path to modified', () => {
    const raw = 'R98\tsrc/old.ts\tsrc/new.ts'
    const result = parseNameStatus(raw)
    expect(result.renames).toEqual({ 'src/old.ts': 'src/new.ts' })
    expect(result.modified).toEqual(['src/new.ts'])
  })

  it('parses C<score> lines (copy) the same way as renames', () => {
    const raw = 'C50\tsrc/orig.ts\tsrc/copy.ts'
    const result = parseNameStatus(raw)
    expect(result.renames).toEqual({ 'src/orig.ts': 'src/copy.ts' })
    expect(result.modified).toEqual(['src/copy.ts'])
  })

  it('parses R without score suffix', () => {
    // Git can emit `R` without a similarity score in older versions
    const raw = 'R\told.ts\tnew.ts'
    const result = parseNameStatus(raw)
    expect(result.renames).toEqual({ 'old.ts': 'new.ts' })
  })

  it('mixes status types and preserves order', () => {
    const raw = [
      'A\ta.ts',
      'R85\told.ts\trenamed.ts',
      'M\tb.ts',
      'D\tc.ts',
    ].join('\n')
    const result = parseNameStatus(raw)
    expect(result.modified).toEqual(['a.ts', 'renamed.ts', 'b.ts', 'c.ts'])
    expect(result.renames).toEqual({ 'old.ts': 'renamed.ts' })
  })

  it('filters to .ts/.tsx/.js/.jsx/.py by default', () => {
    const raw = 'A\tREADME.md\nA\tsrc/a.ts\nA\tsrc/b.tsx\nA\tsrc/c.js\nA\tsrc/d.jsx\nA\tsrc/e.py\nA\tsrc/f.rs'
    const result = parseNameStatus(raw)
    expect(result.modified).toEqual(['src/a.ts', 'src/b.tsx', 'src/c.js', 'src/d.jsx', 'src/e.py'])
  })

  it('respects custom filterExt', () => {
    const raw = 'A\ta.ts\nA\tb.rs\nA\tc.go'
    const result = parseNameStatus(raw, { filterExt: ['.rs', '.go'] })
    expect(result.modified).toEqual(['b.rs', 'c.go'])
  })

  it('disables filtering when filterExt is null', () => {
    const raw = 'A\ta.ts\nA\tb.md\nA\tc.unknown'
    const result = parseNameStatus(raw, { filterExt: null })
    expect(result.modified).toEqual(['a.ts', 'b.md', 'c.unknown'])
  })

  it('keeps a rename when either old or new matches the filter', () => {
    // old .py, new .ts → both keep
    const result1 = parseNameStatus('R90\told.py\tnew.ts')
    expect(result1.renames).toEqual({ 'old.py': 'new.ts' })
    expect(result1.modified).toEqual(['new.ts'])
    // both .md → drop
    const result2 = parseNameStatus('R90\told.md\tnew.md')
    expect(result2.renames).toEqual({})
    expect(result2.modified).toEqual([])
  })

  it('ignores malformed lines and unknown status codes', () => {
    const raw = [
      'M\ta.ts',
      'U\tunmerged.ts', // unmerged — ignored
      'T\ttype-change.ts', // type change — ignored
      '', // empty line
      'X', // single field — ignored
      'M', // status only — ignored
      'R98\told.ts', // missing new path — ignored
    ].join('\n')
    const result = parseNameStatus(raw)
    expect(result.modified).toEqual(['a.ts'])
    expect(result.renames).toEqual({})
  })

  it('handles CRLF line endings', () => {
    const raw = 'A\ta.ts\r\nM\tb.ts\r\n'
    const result = parseNameStatus(raw)
    expect(result.modified).toEqual(['a.ts', 'b.ts'])
  })
})
