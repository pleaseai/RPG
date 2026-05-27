import type { NamuNode, NamuPoint, NamuTree } from './types'

/**
 * Adapter bridging the native @kreuzberg/tree-sitter-language-pack `Node` API
 * (method-based: `kind()`, `startByte()`, `childByFieldName()`, …) to the
 * property-based `NamuNode` interface consumed by `@pleaseai/soop-ast` and
 * `@pleaseai/soop-encoder`.
 *
 * Two impedance mismatches the adapter absorbs:
 *  1. The native node exposes no `.text` — text is sliced from the source via
 *     byte offsets. tree-sitter offsets are UTF-8 *byte* positions while JS
 *     strings are UTF-16, so we slice an encoded byte buffer (threaded through
 *     every node) and decode it — `String.prototype.slice` would corrupt any
 *     non-ASCII source.
 *  2. The native node exposes no sibling accessors — `previousSibling` /
 *     `nextSibling` are derived from the parent's child list and this node's
 *     index within it.
 */

const textDecoder = new TextDecoder()

/** Minimal shape of the native `Node` we depend on. */
interface NativeNode {
  kind: (() => string) | string
  childCount: (() => number) | number
  namedChildCount: (() => number) | number
  child: (index: number) => NativeNode | null
  namedChild: (index: number) => NativeNode | null
  childByFieldName: (name: string) => NativeNode | null
  startByte: (() => number) | number
  endByte: (() => number) | number
  startPosition: (() => NamuPoint) | NamuPoint
  endPosition: (() => NamuPoint) | NamuPoint
  hasError: (() => boolean) | boolean
  isNamed: (() => boolean) | boolean
  isMissing: (() => boolean) | boolean
  toSexp: (() => string) | string
}

interface NativeTree {
  rootNode: (() => NativeNode) | NativeNode
}

/**
 * Resolve a native accessor that may be exposed either as a zero-arg method
 * or as a getter property, returning its value uniformly.
 */
function value<T>(accessor: ((this: NativeNode) => T) | T, self: NativeNode): T {
  return typeof accessor === 'function'
    ? (accessor as (this: NativeNode) => T).call(self)
    : accessor
}

class NamuNodeAdapter implements NamuNode {
  private readonly native: NativeNode
  /** UTF-8 encoded source — sliced by native byte offsets to resolve `.text`. */
  private readonly bytes: Uint8Array
  private readonly _parent: NamuNodeAdapter | null
  private readonly indexInParent: number

  private _children?: NamuNodeAdapter[]
  private _namedChildren?: NamuNodeAdapter[]

  constructor(
    native: NativeNode,
    bytes: Uint8Array,
    parent: NamuNodeAdapter | null,
    indexInParent: number,
  ) {
    this.native = native
    this.bytes = bytes
    this._parent = parent
    this.indexInParent = indexInParent
  }

  get type(): string {
    return value(this.native.kind, this.native)
  }

  get text(): string {
    // Native offsets are UTF-8 byte positions; decode the byte slice so
    // multi-byte (non-ASCII) source is preserved exactly.
    return textDecoder.decode(this.bytes.subarray(this.startIndex, this.endIndex))
  }

  get startIndex(): number {
    return value(this.native.startByte, this.native)
  }

  get endIndex(): number {
    return value(this.native.endByte, this.native)
  }

  get startPosition(): NamuPoint {
    const p = value(this.native.startPosition, this.native)
    return { row: p.row, column: p.column }
  }

  get endPosition(): NamuPoint {
    const p = value(this.native.endPosition, this.native)
    return { row: p.row, column: p.column }
  }

  get childCount(): number {
    return value(this.native.childCount, this.native)
  }

  get namedChildCount(): number {
    return value(this.native.namedChildCount, this.native)
  }

  get children(): NamuNode[] {
    if (!this._children) {
      const out: NamuNodeAdapter[] = []
      const count = this.childCount
      for (let i = 0; i < count; i++) {
        const c = this.native.child(i)
        if (c)
          out.push(new NamuNodeAdapter(c, this.bytes, this, i))
      }
      this._children = out
    }
    return this._children
  }

  get namedChildren(): NamuNode[] {
    if (!this._namedChildren) {
      // Reuse the full-children adapters (filtered to named nodes) rather than
      // building a separate list indexed by named position. Each adapter must
      // carry its index within the *full* child list so previousSibling /
      // nextSibling — which traverse all children — resolve correctly; a
      // named-list index would corrupt them whenever unnamed tokens are interspersed.
      this._namedChildren = (this.children as NamuNodeAdapter[]).filter(c => c.isNamed)
    }
    return this._namedChildren
  }

  child(index: number): NamuNode | null {
    return (this.children as NamuNodeAdapter[])[index] ?? null
  }

  namedChild(index: number): NamuNode | null {
    return (this.namedChildren as NamuNodeAdapter[])[index] ?? null
  }

  childForFieldName(fieldName: string): NamuNode | null {
    const field = this.native.childByFieldName(fieldName)
    if (!field)
      return null
    // Reuse the adapter instance from `children` so the returned node carries a
    // consistent parent/index (and therefore correct sibling links). The field
    // child is always a direct child, matched by byte range.
    const start = value(field.startByte, field)
    const end = value(field.endByte, field)
    const match = (this.children as NamuNodeAdapter[]).find(
      c => c.startIndex === start && c.endIndex === end,
    )
    return match ?? new NamuNodeAdapter(field, this.bytes, this, -1)
  }

  get parent(): NamuNode | null {
    return this._parent
  }

  get previousSibling(): NamuNode | null {
    if (!this._parent || this.indexInParent < 0)
      return null
    return (this._parent.children as NamuNodeAdapter[])[this.indexInParent - 1] ?? null
  }

  get nextSibling(): NamuNode | null {
    if (!this._parent || this.indexInParent < 0)
      return null
    return (this._parent.children as NamuNodeAdapter[])[this.indexInParent + 1] ?? null
  }

  get hasError(): boolean {
    return value(this.native.hasError, this.native)
  }

  get isNamed(): boolean {
    return value(this.native.isNamed, this.native)
  }

  get isMissing(): boolean {
    return value(this.native.isMissing, this.native)
  }

  toString(): string {
    return value(this.native.toSexp, this.native)
  }
}

/**
 * Wrap a native parse tree as a `NamuTree`, threading `source` so adapted nodes
 * can resolve `.text` from byte offsets.
 */
export function wrapTree(nativeTree: NativeTree, source: string): NamuTree {
  const root = value(nativeTree.rootNode, nativeTree as unknown as NativeNode)
  // Encode once per tree; nodes slice this buffer by native UTF-8 byte offsets.
  const bytes = new TextEncoder().encode(source)
  const rootNode = new NamuNodeAdapter(root, bytes, null, -1)
  return {
    rootNode,
    copy: () => wrapTree(nativeTree, source),
    delete: () => {},
  }
}

export { NamuNodeAdapter }
export type { NativeNode, NativeTree }
