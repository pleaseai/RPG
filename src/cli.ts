#!/usr/bin/env bun
import { program } from 'commander'
import { RPGEncoder } from './encoder'
import { RepositoryPlanningGraph } from './graph'
import { ExploreRPG, FetchNode, SearchNode } from './tools'
import { ZeroRepo } from './zerorepo'

program
  .name('rpg')
  .description('Repository Planning Graph - Code understanding and generation')
  .version('0.1.0')

// Encode command
program
  .command('encode')
  .description('Encode a repository into an RPG')
  .argument('<path>', 'Repository path')
  .option('-o, --output <file>', 'Output file path', 'rpg.json')
  .option('--include-source', 'Include source code in nodes')
  .option('-i, --include <patterns...>', 'Include file patterns (default: **/*.ts,**/*.js,**/*.py)')
  .option(
    '-e, --exclude <patterns...>',
    'Exclude file patterns (default: **/node_modules/**,**/dist/**)',
  )
  .option('-d, --max-depth <depth>', 'Maximum directory depth', '10')
  .option('--verbose', 'Show detailed progress')
  .action(
    async (
      repoPath: string,
      options: {
        output: string
        includeSource?: boolean
        include?: string[]
        exclude?: string[]
        maxDepth: string
        verbose?: boolean
      },
    ) => {
      console.log(`Encoding repository: ${repoPath}`)
      if (options.verbose) {
        console.log(
          `  Include patterns: ${options.include?.join(', ') || '**/*.ts,**/*.js,**/*.py'}`,
        )
        console.log(
          `  Exclude patterns: ${options.exclude?.join(', ') || '**/node_modules/**,**/dist/**'}`,
        )
        console.log(`  Max depth: ${options.maxDepth}`)
      }

      const encoder = new RPGEncoder(repoPath, {
        includeSource: options.includeSource,
        include: options.include,
        exclude: options.exclude,
        maxDepth: Number.parseInt(options.maxDepth),
      })

      const result = await encoder.encode()

      await Bun.write(options.output, await result.rpg.toJSON())

      const stats = await result.rpg.getStats()

      console.log('\nEncoding complete:')
      console.log(`  Files processed: ${result.filesProcessed}`)
      console.log(`  Entities extracted: ${result.entitiesExtracted}`)
      console.log(`  Duration: ${result.duration}ms`)
      console.log(`  Output: ${options.output}`)

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
      const file = Bun.file(options.specFile)
      spec = await file.text()
    }

    if (!spec) {
      console.error('Error: Either --spec or --spec-file is required')
      process.exit(1)
    }

    console.log('Generating repository...')
    console.log(`Specification: ${spec.substring(0, 100)}...`)

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
  .requiredOption('--rpg <file>', 'RPG file path')
  .option('-t, --term <term>', 'Search term')
  .option('-m, --mode <mode>', 'Search mode (features, snippets, auto)', 'auto')
  .option('-p, --pattern <pattern>', 'File pattern for snippet search')
  .action(async (options: { rpg: string, term?: string, mode: string, pattern?: string }) => {
    const file = Bun.file(options.rpg)
    const json = await file.text()
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
  .requiredOption('--rpg <file>', 'RPG file path')
  .argument('<entities...>', 'Entity IDs to fetch')
  .action(async (entities: string[], options: { rpg: string }) => {
    const file = Bun.file(options.rpg)
    const json = await file.text()
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
  .requiredOption('--rpg <file>', 'RPG file path')
  .argument('<node>', 'Starting node ID')
  .option('-e, --edge-type <type>', 'Edge type (functional, dependency, both)', 'both')
  .option('-d, --depth <depth>', 'Maximum depth', '3')
  .option('--direction <dir>', 'Direction (out, in, both)', 'out')
  .action(
    async (
      node: string,
      options: { rpg: string, edgeType: string, depth: string, direction: string },
    ) => {
      const file = Bun.file(options.rpg)
      const json = await file.text()
      const rpg = await RepositoryPlanningGraph.fromJSON(json)

      const explorer = new ExploreRPG(rpg)
      const results = await explorer.traverse({
        startNode: node,
        edgeType: options.edgeType as 'functional' | 'dependency' | 'both',
        maxDepth: Number.parseInt(options.depth),
        direction: options.direction as 'out' | 'in' | 'both',
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
  .description('Update RPG with new commits')
  .requiredOption('--rpg <file>', 'RPG file path')
  .option('-c, --commits <range>', 'Commit range', 'HEAD~1..HEAD')
  .action(async (options: { rpg: string, commits: string }) => {
    console.log(`Evolving RPG with commits: ${options.commits}`)
    // TODO: Implement evolution
    console.log('Evolution not yet implemented')
  })

// Stats command
program
  .command('stats')
  .description('Show RPG statistics')
  .argument('<file>', 'RPG file path')
  .action(async (filePath: string) => {
    const file = Bun.file(filePath)
    const json = await file.text()
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

program.parse()
