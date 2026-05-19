import type { RpgData } from './types'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildDepTree, extractDepGraph, getSemanticEdges } from './dep-graph'
import { countNodes, normalizeToTree } from './tree'

let cachedTemplate: string | null = null

/**
 * Load the inline HTML+D3 template that ships with this package. The file
 * lives at `src/template.html` (next to this module) so it works in both
 * raw-source (Bun dev) and bundled (tsdown copies the asset) contexts.
 */
async function loadTemplate(): Promise<string> {
  if (cachedTemplate)
    return cachedTemplate
  const here = path.dirname(fileURLToPath(import.meta.url))
  // After bundling, the template is placed next to the compiled file.
  const candidates = [
    path.join(here, 'template.html'),
    path.join(here, '..', 'src', 'template.html'),
  ]
  for (const candidate of candidates) {
    try {
      cachedTemplate = await readFile(candidate, 'utf-8')
      return cachedTemplate
    }
    catch {
      // try next
    }
  }
  throw new Error(`visualize template.html not found; looked in: ${candidates.join(', ')}`)
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

// `String.fromCharCode` keeps the source file ASCII-only; embedding the
// literal U+2028/U+2029 characters here would otherwise be parsed as line
// terminators and fragment this module.
const U2028 = String.fromCharCode(0x2028)
const U2029 = String.fromCharCode(0x2029)

/**
 * Serialize a value as JSON safe for inlining into a `<script>` block.
 *
 * `JSON.stringify` does not escape `</script>` or the JS line
 * terminators U+2028 / U+2029. Without escaping, any string field whose
 * value contains those sequences breaks out of the script block (or, for
 * the line terminators, breaks the JS parse). Reachable here because
 * encoded RPGs carry arbitrary code-derived strings: file paths, class
 * names, feature descriptions, etc. Replacing `<` with the `<`
 * escape keeps the JSON deserializable as the same value while
 * neutralizing the HTML parser's script-end detection.
 */
function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll(U2028, '\\u2028')
    .replaceAll(U2029, '\\u2029')
}

/** Format a `{key: count}` map into the legend string used by the vendor template. */
function formatEdgeSummary(stats: Record<string, number>): string {
  return Object.keys(stats)
    .sort()
    .map(k => `${k}: ${stats[k]}`)
    .join(', ')
}

/**
 * Render a complete self-contained HTML visualization of an RPG.
 * Ported from `rpg_visualize.py::generate_html()` (lines 230-1872).
 *
 * Returns the full HTML string. Callers typically write it next to the
 * `rpg.json` it visualizes (RPG-Kit `run_encode.py` Step 4).
 */
export async function generateHtml(data: RpgData): Promise<string> {
  const tree = normalizeToTree(data)
  const semanticEdges = getSemanticEdges(data)
  const dep = extractDepGraph(data)
  const depTree = buildDepTree(data)
  const depToRpg = data._dep_to_rpg_map ?? {}
  const repoName = data.repo_name ?? 'Unknown'
  const featNodeCount = countNodes(tree)
  const featEdgeCount = semanticEdges.length

  // Aggregate feature edges by relation for the legend line
  const featStats: Record<string, number> = {}
  for (const e of semanticEdges) {
    const rel = e.relation ?? 'unknown'
    featStats[rel] = (featStats[rel] ?? 0) + 1
  }
  const featEdgeSummary = formatEdgeSummary(featStats)

  const depNodeCount = dep.nodes.length
  const depEdgeCount = dep.edges.length
  const depEdgeSummary = formatEdgeSummary(dep.stats)
  const hasDep = depNodeCount > 0
  const hasMap = Object.keys(depToRpg).length > 0
  const depToRpgLen = Object.keys(depToRpg).length
  const mapCount = Object.values(depToRpg).reduce((sum, arr) => sum + arr.length, 0)

  const template = await loadTemplate()
  return template
    .replaceAll('__REPO_NAME__', escapeHtml(repoName))
    .replaceAll('__FEAT_NODE_COUNT__', String(featNodeCount))
    .replaceAll('__FEAT_EDGE_COUNT__', String(featEdgeCount))
    .replaceAll('__FEAT_EDGE_SUMMARY__', escapeHtml(featEdgeSummary))
    .replaceAll('__DEP_NODE_COUNT__', String(depNodeCount))
    .replaceAll('__DEP_EDGE_COUNT__', String(depEdgeCount))
    .replaceAll('__DEP_EDGE_SUMMARY__', escapeHtml(depEdgeSummary))
    .replaceAll('__DEP_TO_RPG_LEN__', String(depToRpgLen))
    .replaceAll('__MAP_COUNT__', String(mapCount))
    .replaceAll('__TREE_JSON__', jsonForScript(tree))
    .replaceAll('__EDGES_JSON__', jsonForScript(semanticEdges))
    .replaceAll('__DEP_NODES_JSON__', jsonForScript(dep.nodes))
    .replaceAll('__DEP_EDGES_JSON__', jsonForScript(dep.edges))
    .replaceAll('__DEP_PARENT_JSON__', jsonForScript(dep.parent_map))
    .replaceAll('__DEP_TREE_JSON__', jsonForScript(depTree))
    .replaceAll('__DEP_TO_RPG_JSON__', jsonForScript(depToRpg))
    .replaceAll('__HAS_DEP__', hasDep ? 'true' : 'false')
    .replaceAll('__HAS_MAP__', hasMap ? 'true' : 'false')
}
