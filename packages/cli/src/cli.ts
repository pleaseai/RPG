#!/usr/bin/env node
import type { SemanticOptions } from '@pleaseai/soop-encoder/semantic'
import type { SerializedEmbeddings } from '@pleaseai/soop-graph/embeddings'

import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { RPGEncoder } from '@pleaseai/soop-encoder'
import { AISDKEmbedding, HuggingFaceEmbedding } from '@pleaseai/soop-encoder/embedding'
import { EmbeddingManager } from '@pleaseai/soop-encoder/embedding-manager'
import { RepositoryPlanningGraph } from '@pleaseai/soop-graph'
import { parseEmbeddingsJsonl, serializeEmbeddingsJsonl } from '@pleaseai/soop-graph/embeddings'
import { ExploreRPG, FetchNode, SearchNode } from '@pleaseai/soop-tools'
import { getHeadCommitSha } from '@pleaseai/soop-utils/git-helpers'
import { parseModelString } from '@pleaseai/soop-utils/llm'
import { createLogger, LogLevels, setLogLevel } from '@pleaseai/soop-utils/logger'
import { ZeroRepo } from '@pleaseai/soop-zerorepo'
import { program } from 'commander'
import { config } from 'dotenv'

import pkg from '../package.json'
import { registerInitCommand } from './commands/init'
import { registerMcpCommand } from './commands/mcp'
import { registerSyncCommand } from './commands/sync'

const log = createLogger('CLI')

const RPG_EXT_RE = /\.jsonl?$/i

config({ path: ['.env.local', '.env'], quiet: true })

program
  .name('soop')
  .description('Repository Planning Graph - Code understanding and generation')
  .version(pkg.version)

// Register subcommands
registerInitCommand(program)
registerMcpCommand(program)
registerSyncCommand(program)

// Encode command
program
  .command('encode')
  .description('Encode a repository into an RPG')
  .argument('<path>', 'Repository path')
  .option('-o, --output <file>', 'Output file path (default: rpg.json or rpg.jsonl based on --format)')
  .option('-f, --format <format>', 'Output format: json or jsonl', 'jsonl')
  .option('--include-source', 'Include source code in nodes')
  .option('-i, --include <patterns...>', 'Include file patterns (default: **/*.ts,**/*.js,**/*.py)')
  .option(
    '-e, --exclude <patterns...>',
    'Exclude file patterns (default: **/node_modules/**,**/dist/**)',
  )
  .option('-d, --max-depth <depth>', 'Maximum directory depth', '10')
  .option('--no-gitignore', 'Disable .gitignore filtering (include all files)')
  .option('-m, --model <provider/model>', 'LLM provider/model (e.g., codex/gpt-5.3-codex, claude-code/haiku, openai/gpt-5.2, google)')
  .option('--no-llm', 'Disable LLM (use heuristic extraction)')
  .option('-s, --search <strategy>', 'Search strategy: text (BM25, free), vector (embedding), hybrid (both)', 'text')
  .option('--embed-model <provider/model>', 'Embedding model for vector/hybrid search (default: voyage-ai/voyage-code-3). Use transformers/<model-id> for local models')
  .option('--embed-output <path>', 'Embeddings output file path', '.soop/embeddings.jsonl')
  .option('--verbose', 'Show detailed progress')
  .option('--min-batch-tokens <tokens>', 'Minimum tokens per batch (default: 10000)')
  .option('--max-batch-tokens <tokens>', 'Maximum tokens per batch (default: 50000)')
  .option('--no-dep-graph', 'Skip writing the vendor-schema dep_graph.json sidecar')
  .option('--no-viz', 'Skip writing the HTML visualization next to the RPG output')
  .action(
    async (
      repoPath: string,
      options: {
        output?: string
        format: string
        includeSource?: boolean
        include?: string[]
        exclude?: string[]
        maxDepth: string
        gitignore?: boolean
        model?: string
        llm?: boolean
        search: string
        embedModel?: string
        embedOutput: string
        verbose?: boolean
        minBatchTokens?: string
        maxBatchTokens?: string
        depGraph?: boolean
        viz?: boolean
      },
    ) => {
      if (options.verbose) {
        setLogLevel(LogLevels.debug)
      }

      validateSearchStrategy(options.search)

      if (options.format && !['json', 'jsonl'].includes(options.format)) {
        log.error(`Invalid format "${options.format}". Must be "json" or "jsonl".`)
        process.exit(1)
      }

      const semantic = buildSemanticOptions(options.model, options.llm, options.minBatchTokens, options.maxBatchTokens)

      log.info(`Encoding repository: ${repoPath}`)
      log.debug(
        `  Include patterns: ${options.include?.join(', ') || '**/*.ts,**/*.js,**/*.py'}`,
      )
      log.debug(
        `  Exclude patterns: ${options.exclude?.join(', ') || '**/node_modules/**,**/dist/**'}`,
      )
      log.debug(`  Max depth: ${options.maxDepth}`)

      const encoder = new RPGEncoder(repoPath, {
        includeSource: options.includeSource,
        include: options.include,
        exclude: options.exclude,
        maxDepth: Number.parseInt(options.maxDepth),
        respectGitignore: options.gitignore !== false,
        semantic,
      })

      const result = await encoder.encode()

      const outputPath = options.output ?? (options.format === 'json' ? 'rpg.json' : 'rpg.jsonl')
      await encoder.save(outputPath)

      // Step 2: write dep_graph.json sidecar (matches RPG-Kit run_encode.py:98-140).
      // Defensive try/catch so a serializer hiccup never blocks the main encode.
      let depGraphPath: string | undefined
      if (options.depGraph !== false) {
        const candidate = path.join(path.dirname(outputPath), 'dep_graph.json')
        try {
          depGraphPath = await encoder.writeDepGraph(candidate, { rpgPath: outputPath })
          // Re-save the RPG so the dep_graph_file field lands on disk.
          await encoder.save(outputPath)
        }
        catch (err) {
          depGraphPath = undefined
          log.warn(`dep_graph step failed: ${err instanceof Error ? err.message : String(err)}`)
        }
      }

      // Step 4: render the interactive HTML next to the RPG output.
      let vizPath: string | undefined
      if (options.viz !== false) {
        try {
          const { generateHtml, loadRpg } = await import('@pleaseai/soop-visualize')
          // `loadRpg` expects the canonical JSON RPG payload. When the
          // user picked JSONL, parse the in-memory RPG directly instead
          // of re-reading the JSONL output, and merge the dep_graph from
          // disk so the resulting view matches the saved artifacts.
          const data = outputPath.endsWith('.jsonl')
            ? JSON.parse(await result.rpg.toJSON())
            : await loadRpg(outputPath, depGraphPath)
          if (outputPath.endsWith('.jsonl') && depGraphPath) {
            data.dep_graph = JSON.parse(await readFile(depGraphPath, 'utf-8'))
          }
          const html = await generateHtml(data)
          vizPath = `${outputPath.replace(RPG_EXT_RE, '')}.html`
          await writeFile(vizPath, html)
        }
        catch (err) {
          vizPath = undefined
          log.warn(`visualize step failed: ${err instanceof Error ? err.message : String(err)}`)
        }
      }

      // Generate embeddings for vector/hybrid search
      if (options.search === 'vector' || options.search === 'hybrid') {
        const embedSha = getHeadCommitSha(path.resolve(repoPath))
        const embeddings = await generateEmbeddings(
          result.rpg,
          embedSha,
          options.embedModel,
        )
        await writeEmbeddingsFile(embeddings, options.embedOutput)
      }

      const stats = await result.rpg.getStats()

      console.log('\nEncoding complete:')
      console.log(`  Files processed: ${result.filesProcessed}`)
      console.log(`  Entities extracted: ${result.entitiesExtracted}`)
      console.log(`  Duration: ${result.duration}ms`)
      console.log(`  Output: ${outputPath}`)
      if (depGraphPath)
        console.log(`  Dep graph: ${depGraphPath}`)
      if (vizPath)
        console.log(`  Visualization: ${vizPath}`)

      if (options.verbose) {
        console.log('\nGraph statistics:')
        console.log(`  Total nodes: ${stats.nodeCount}`)
        console.log(`    High-level (modules): ${stats.highLevelNodeCount}`)
        console.log(`    Low-level (entities): ${stats.lowLevelNodeCount}`)
        console.log(`  Total edges: ${stats.edgeCount}`)
        console.log(`    Functional: ${stats.functionalEdgeCount}`)
        console.log(`    Dependency: ${stats.dependencyEdgeCount}`)
      }
    },
  )

// Generate command
program
  .command('generate')
  .description('Generate a repository from specification')
  .option('-s, --spec <spec>', 'Repository specification')
  .option('-f, --spec-file <file>', 'Specification file')
  .option('-o, --output <dir>', 'Output directory', './generated')
  .option('--no-tests', 'Skip test generation')
  .action(async (options: { spec?: string, specFile?: string, output: string, tests: boolean }) => {
    let spec = options.spec

    if (options.specFile) {
      spec = await readFile(options.specFile, 'utf-8')
    }

    if (!spec) {
      log.error('Either --spec or --spec-file is required')
      process.exit(1)
    }

    log.info('Generating repository...')
    log.info(`Specification: ${spec.substring(0, 100)}...`)

    const zerorepo = new ZeroRepo({
      spec,
      generateTests: options.tests,
    })

    const proposalGraph = await zerorepo.buildProposalGraph()
    const rpg = await zerorepo.buildImplementationGraph(proposalGraph)
    const result = await zerorepo.generateRepository(rpg, options.output)

    console.log('\nGeneration complete:')
    console.log(`  Files generated: ${result.filesGenerated}`)
    console.log(`  Lines of code: ${result.linesOfCode}`)
    console.log(`  Output: ${result.outputPath}`)
  })

// Search command
program
  .command('search')
  .description('Search for features or code in an RPG')
  .requiredOption('--graph <file>', 'RPG file path')
  .option('-t, --term <term>', 'Search term')
  .option('-m, --mode <mode>', 'Search mode (features, snippets, auto)', 'auto')
  .option('-p, --pattern <pattern>', 'File pattern for snippet search')
  .action(async (options: { graph: string, term?: string, mode: string, pattern?: string }) => {
    const json = await readFile(options.graph, 'utf-8')
    const rpg = await RepositoryPlanningGraph.fromJSON(json)

    const search = new SearchNode(rpg)
    const results = await search.query({
      mode: options.mode as 'features' | 'snippets' | 'auto',
      featureTerms: options.term ? [options.term] : undefined,
      filePattern: options.pattern,
    })

    console.log(`\nSearch results (${results.totalMatches} matches):`)
    for (const node of results.nodes) {
      console.log(`\n  ID: ${node.id}`)
      console.log(`  Type: ${node.type}`)
      console.log(`  Feature: ${node.feature.description}`)
      if (node.metadata?.path) {
        console.log(`  Path: ${node.metadata.path}`)
      }
    }
  })

// Fetch command
program
  .command('fetch')
  .description('Fetch detailed information for entities')
  .requiredOption('--graph <file>', 'RPG file path')
  .argument('<entities...>', 'Entity IDs to fetch')
  .action(async (entities: string[], options: { graph: string }) => {
    const json = await readFile(options.graph, 'utf-8')
    const rpg = await RepositoryPlanningGraph.fromJSON(json)

    const fetcher = new FetchNode(rpg)
    const results = await fetcher.get({ codeEntities: entities })

    console.log(`\nFetched ${results.entities.length} entities:`)
    for (const entity of results.entities) {
      console.log(`\n  ID: ${entity.node.id}`)
      console.log(`  Feature: ${entity.node.feature.description}`)
      console.log(`  Path: ${entity.featurePaths.join(' → ')}`)
      if (entity.sourceCode) {
        console.log(`  Source:\n${entity.sourceCode.substring(0, 200)}...`)
      }
    }

    if (results.notFound.length > 0) {
      console.log(`\nNot found: ${results.notFound.join(', ')}`)
    }
  })

// Explore command
program
  .command('explore')
  .description('Explore graph from a starting node')
  .requiredOption('--graph <file>', 'RPG file path')
  .argument('<node>', 'Starting node ID')
  .option('-e, --edge-type <type>', 'Edge type (containment, dependency, all)', 'all')
  .option('-d, --depth <depth>', 'Maximum depth', '3')
  .option('--direction <dir>', 'Direction (downstream, upstream, both)', 'downstream')
  .action(
    async (
      node: string,
      options: { graph: string, edgeType: string, depth: string, direction: string },
    ) => {
      const json = await readFile(options.graph, 'utf-8')
      const rpg = await RepositoryPlanningGraph.fromJSON(json)

      const explorer = new ExploreRPG(rpg)
      const results = await explorer.traverse({
        startNode: node,
        edgeType: options.edgeType as 'containment' | 'dependency' | 'all',
        maxDepth: Number.parseInt(options.depth),
        direction: options.direction as 'downstream' | 'upstream' | 'both',
      })

      console.log(`\nExploration from "${node}":`)
      console.log(`  Nodes discovered: ${results.nodes.length}`)
      console.log(`  Edges traversed: ${results.edges.length}`)
      console.log(`  Max depth reached: ${results.maxDepthReached}`)

      console.log('\nNodes:')
      for (const n of results.nodes) {
        console.log(`  - ${n.id}: ${n.feature.description}`)
      }
    },
  )

// Evolve command
program
  .command('evolve')
  .description('Incrementally update RPG with new commits')
  .argument('<path>', 'Repository path')
  .requiredOption('-l, --load-path <file>', 'RPG file to update')
  .option('-o, --output <file>', 'Output file path (defaults to load-path)')
  .option('-f, --format <format>', 'Output format: json or jsonl (auto-detected from load-path if omitted)')
  .option('-c, --commits <range>', 'Commit range', 'HEAD~1..HEAD')
  .option('-m, --model <provider/model>', 'LLM provider/model (e.g., codex/gpt-5.3-codex, claude-code/haiku, openai/gpt-5.2, google)')
  .option('--no-llm', 'Disable LLM (use heuristic extraction)')
  .option('-s, --search <strategy>', 'Search strategy: text (BM25, free), vector (embedding), hybrid (both)', 'text')
  .option('--embed-model <provider/model>', 'Embedding model for vector/hybrid search')
  .option('--embed-output <path>', 'Embeddings output file path', '.soop/embeddings.jsonl')
  .option('--verbose', 'Show detailed progress')
  .option('--min-batch-tokens <tokens>', 'Minimum tokens per batch (default: 10000)')
  .option('--max-batch-tokens <tokens>', 'Maximum tokens per batch (default: 50000)')
  .action(async (repoPath: string, options: { loadPath: string, output?: string, format?: string, commits: string, model?: string, llm?: boolean, search: string, embedModel?: string, embedOutput: string, verbose?: boolean, minBatchTokens?: string, maxBatchTokens?: string }) => {
    if (options.verbose) {
      setLogLevel(LogLevels.debug)
    }

    validateSearchStrategy(options.search)

    if (options.format && !['json', 'jsonl'].includes(options.format)) {
      log.error(`Invalid format "${options.format}". Must be "json" or "jsonl".`)
      process.exit(1)
    }

    let outputPath: string
    if (options.output) {
      outputPath = options.output
    }
    else if (options.format) {
      const ext = path.extname(options.loadPath)
      const base = options.loadPath.slice(0, -ext.length || undefined)
      outputPath = `${base}.${options.format}`
    }
    else {
      outputPath = options.loadPath
    }

    log.info(`Evolving RPG with commits: ${options.commits}`)

    const semantic = buildSemanticOptions(options.model, options.llm, options.minBatchTokens, options.maxBatchTokens)

    const encoder = await RPGEncoder.fromSaved(options.loadPath, repoPath, { semantic })
    encoder.rpg?.updateConfig({ rootPath: path.resolve(repoPath) })
    const result = await encoder.evolve({ commitRange: options.commits })

    await encoder.save(outputPath)

    // Embedding update for vector/hybrid search
    if (options.search === 'vector' || options.search === 'hybrid') {
      const rpg = encoder.rpg
      if (!rpg)
        throw new Error('RPG not available after evolve')

      const embedSha = getHeadCommitSha(path.resolve(repoPath))
      const embeddingManager = await createEmbeddingManager(options.embedModel)

      if (result.embeddingChanges && existsSync(options.embedOutput)) {
        // Incremental: update only changed nodes (if model matches)
        const existingJsonl = await readFile(options.embedOutput, 'utf-8')
        const existing = parseEmbeddingsJsonl(existingJsonl)
        const parsed = parseEmbedModelString(options.embedModel ?? 'voyage-ai/voyage-code-3')
        const currentModel = `${parsed.providerName}/${parsed.model}`
        const existingModel = `${existing.config.provider}/${existing.config.model}`
        if (existingModel.toLowerCase() !== currentModel.toLowerCase()) {
          log.warn(`Embedding model changed (${existingModel} → ${currentModel}) — full re-index required`)
          const embeddings = await embeddingManager.indexAll(rpg, embedSha)
          await writeEmbeddingsFile(embeddings, options.embedOutput)
        }
        else {
          const updated = await embeddingManager.applyChanges(existing, rpg, result.embeddingChanges, embedSha)
          await writeEmbeddingsFile(updated, options.embedOutput)
        }
      }
      else {
        // Full generation: no existing embeddings or no change tracking
        if (!result.embeddingChanges) {
          log.warn('Evolve did not produce embeddingChanges — falling back to full embedding generation')
        }
        const embeddings = await embeddingManager.indexAll(rpg, embedSha)
        await writeEmbeddingsFile(embeddings, options.embedOutput)
      }
    }

    console.log('\nEvolution complete:')
    console.log(`  Inserted: ${result.inserted}`)
    console.log(`  Modified: ${result.modified}`)
    console.log(`  Deleted: ${result.deleted}`)
    console.log(`  Rerouted: ${result.rerouted}`)
    console.log(`  Duration: ${result.duration}ms`)
    if (result.errors.length > 0) {
      log.warn(`Errors (${result.errors.length}):`)
      for (const err of result.errors) {
        log.warn(`  [${err.phase}] ${err.entity}: ${err.error}`)
      }
    }
  })

// Stats command
program
  .command('stats')
  .description('Show RPG statistics')
  .argument('<file>', 'RPG file path')
  .action(async (filePath: string) => {
    const json = await readFile(filePath, 'utf-8')
    const rpg = await RepositoryPlanningGraph.fromJSON(json)
    const stats = await rpg.getStats()
    const config = rpg.getConfig()

    console.log(`\nRPG Statistics for "${config.name}":`)
    console.log(`  Total nodes: ${stats.nodeCount}`)
    console.log(`    High-level: ${stats.highLevelNodeCount}`)
    console.log(`    Low-level: ${stats.lowLevelNodeCount}`)
    console.log(`  Total edges: ${stats.edgeCount}`)
    console.log(`    Functional: ${stats.functionalEdgeCount}`)
    console.log(`    Dependency: ${stats.dependencyEdgeCount}`)
  })

// Stamp command
program
  .command('stamp')
  .description('Stamp config.github.commit with current HEAD SHA')
  .argument('<file>', 'RPG file path')
  .action(async (filePath: string) => {
    const encoder = await RPGEncoder.fromSaved(filePath)
    await encoder.save(filePath)
    const commit = encoder.rpg?.getConfig().github?.commit
    if (!commit) {
      log.error('Failed to stamp: could not determine HEAD commit SHA')
      process.exit(1)
    }
    console.log(commit)
  })

// Last-commit command
program
  .command('last-commit')
  .description('Print the last encoded commit SHA from .meta.json')
  .argument('<file>', 'RPG file path')
  .action(async (filePath: string) => {
    const { metaPathFor, deserializeMeta } = await import('@pleaseai/soop-graph/meta')
    const metaFile = metaPathFor(filePath)
    let commit: string | undefined
    try {
      const metaJson = await readFile(metaFile, 'utf-8')
      const meta = deserializeMeta(JSON.parse(metaJson))
      commit = meta.github?.commit
    }
    catch (metaError) {
      log.debug(`Could not read meta file, falling back to graph: ${metaError instanceof Error ? metaError.message : String(metaError)}`)
      // Fallback: try loading from graph (for backward compat)
      try {
        const json = await readFile(filePath, 'utf-8')
        const rpg = await RepositoryPlanningGraph.fromJSON(json)
        commit = rpg.getConfig().github?.commit
      }
      catch (graphError) {
        log.debug(`Could not load commit from graph: ${graphError instanceof Error ? graphError.message : String(graphError)}`)
      }
    }
    if (!commit) {
      log.error('No commit stamp found')
      process.exit(1)
    }
    console.log(commit)
  })

const VALID_SEARCH_STRATEGIES = ['text', 'vector', 'hybrid'] as const

function validateSearchStrategy(strategy: string): void {
  if (!VALID_SEARCH_STRATEGIES.includes(strategy as typeof VALID_SEARCH_STRATEGIES[number])) {
    log.error(`Invalid search strategy "${strategy}". Must be one of: ${VALID_SEARCH_STRATEGIES.join(', ')}`)
    process.exit(1)
  }
}

/**
 * Build SemanticOptions from CLI flags
 */
function buildSemanticOptions(
  model?: string,
  llm?: boolean,
  minBatchTokens?: string,
  maxBatchTokens?: string,
): SemanticOptions | undefined {
  const hasBatchOptions = minBatchTokens !== undefined || maxBatchTokens !== undefined
  if (!model && llm !== false && !hasBatchOptions) {
    return undefined
  }

  const parsedMin = minBatchTokens !== undefined ? Number.parseInt(minBatchTokens, 10) : undefined
  const parsedMax = maxBatchTokens !== undefined ? Number.parseInt(maxBatchTokens, 10) : undefined

  if (parsedMin !== undefined && (Number.isNaN(parsedMin) || parsedMin < 0)) {
    log.error(`Invalid --min-batch-tokens value: ${minBatchTokens}`)
    process.exit(1)
  }
  if (parsedMax !== undefined && (Number.isNaN(parsedMax) || parsedMax < 0)) {
    log.error(`Invalid --max-batch-tokens value: ${maxBatchTokens}`)
    process.exit(1)
  }
  if (parsedMin !== undefined && parsedMax !== undefined && parsedMin > parsedMax) {
    log.error(`--min-batch-tokens (${parsedMin}) cannot be greater than --max-batch-tokens (${parsedMax})`)
    process.exit(1)
  }

  return {
    ...(model ? parseModelString(model) : {}),
    useLLM: llm !== false,
    ...(parsedMin !== undefined ? { minBatchTokens: parsedMin } : {}),
    ...(parsedMax !== undefined ? { maxBatchTokens: parsedMax } : {}),
  }
}

/** Git LFS size warning threshold (10MB) */
const GIT_LFS_THRESHOLD = 10 * 1024 * 1024

/**
 * Create an EmbeddingManager from a model string.
 * Supports API-based providers (voyage-ai/, openai/) and local transformers (transformers/).
 */
async function createEmbeddingManager(
  embedModelStr: string = 'voyage-ai/voyage-code-3',
): Promise<EmbeddingManager> {
  const [providerPart] = embedModelStr.split('/')

  if (providerPart === 'transformers') {
    const modelId = embedModelStr.slice('transformers/'.length)
    const embedding = new HuggingFaceEmbedding({ model: modelId })
    return new EmbeddingManager(embedding, {
      provider: 'transformers',
      model: modelId,
      dimension: embedding.getDimension(),
    })
  }

  const { createOpenAI } = await import('@ai-sdk/openai')
  const parsed = parseEmbedModelString(embedModelStr)

  const provider = createOpenAI({
    baseURL: parsed.baseURL,
    apiKey: parsed.apiKey,
  })

  const embedding = new AISDKEmbedding({
    model: provider.embedding(parsed.model),
    dimension: parsed.dimension,
    providerName: parsed.providerName,
  })

  return new EmbeddingManager(embedding, {
    provider: parsed.providerName,
    model: parsed.model,
    dimension: parsed.dimension,
    space: parsed.space,
  })
}

/**
 * Generate embeddings for all nodes in an RPG.
 */
async function generateEmbeddings(
  rpg: RepositoryPlanningGraph,
  commit: string,
  embedModelStr?: string,
): Promise<SerializedEmbeddings> {
  const manager = await createEmbeddingManager(embedModelStr)
  return manager.indexAll(rpg, commit)
}

/**
 * Write embeddings to file with size warning.
 */
async function writeEmbeddingsFile(embeddings: SerializedEmbeddings, outputPath: string): Promise<void> {
  const content = serializeEmbeddingsJsonl(embeddings)
  await writeFile(outputPath, content)

  const size = Buffer.byteLength(content)
  const sizeMB = (size / (1024 * 1024)).toFixed(1)
  log.success(`Embeddings written: ${outputPath} (${sizeMB}MB, ${embeddings.embeddings.length} nodes)`)

  if (size > GIT_LFS_THRESHOLD) {
    log.warn(`embeddings.jsonl is ${sizeMB}MB. Consider using Git LFS:`)
    log.warn(`  git lfs track "${outputPath}"`)
  }
}

interface ParsedEmbedModel {
  providerName: string
  model: string
  baseURL: string
  apiKey: string
  dimension: number
  space?: string
}

/**
 * Parse embed model string like "voyage-ai/voyage-code-3" or "openai/text-embedding-3-small"
 */
function parseEmbedModelString(embedModelStr: string): ParsedEmbedModel {
  const [providerPart, ...modelParts] = embedModelStr.split('/')
  const model = modelParts.join('/') || providerPart!

  switch (providerPart) {
    case 'voyage-ai': {
      const voyageApiKey = process.env.VOYAGE_API_KEY
      if (!voyageApiKey) {
        throw new Error('VOYAGE_API_KEY environment variable is required for voyage-ai embeddings')
      }
      return {
        providerName: 'VoyageAI',
        model,
        baseURL: 'https://api.voyageai.com/v1',
        apiKey: voyageApiKey,
        dimension: 1024,
        space: 'voyage-v4',
      }
    }
    case 'openai': {
      const openaiApiKey = process.env.OPENAI_API_KEY
      if (!openaiApiKey) {
        throw new Error('OPENAI_API_KEY environment variable is required for openai embeddings')
      }
      return {
        providerName: 'OpenAI',
        model,
        baseURL: 'https://api.openai.com/v1',
        apiKey: openaiApiKey,
        dimension: model === 'text-embedding-3-large' ? 3072 : 1536,
      }
    }
    default:
      return {
        providerName: providerPart!,
        model,
        baseURL: process.env.EMBEDDING_BASE_URL ?? 'https://api.openai.com/v1',
        apiKey: process.env.EMBEDDING_API_KEY ?? process.env.OPENAI_API_KEY ?? '',
        dimension: 1024,
      }
  }
}

program.parse()
