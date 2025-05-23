import kerror from '../kerror.ts'
import { getLatestCommit } from '../git.ts'
import { Dependency } from '../schemas/klep.deps.schema.ts'
import { DependencyGraph, ResolvedDependency, RequiredDependency } from '../schemas/klep.keep.schema.ts'

type DependencyNode = {
  name: string
  url: string
  version: string
  extract?: Record<string, string> | 'all'
  requires: RequiredDependency[]
}

type DependencyMap = Map<string, DependencyNode>


export class DependencyResolver {
  private graph: DependencyMap = new Map()
  private visited: Set<string> = new Set()
  private resolved: Set<string> = new Set()

  constructor(private deps: Record<string, Dependency>) {}

  async resolve(): Promise<DependencyGraph> {
    // Start with direct dependencies
    for (const [name, dep] of Object.entries(this.deps)) {
      await this.resolveDependency(name, dep)
    }

    // Convert the graph to the keepfile format
    return Array.from(this.graph.values()).map((node): ResolvedDependency => ({
      name: node.name,
      requested: [{
        version: node.version,
        extract: node.extract,
      }],
      resolved: {
        version: node.version,
        extract: node.extract || 'all',
        requires: node.requires,
      },
    }))
  }

  private async resolveDependency(name: string, dep: Dependency): Promise<void> {
    if (this.visited.has(name)) {
      if (!this.resolved.has(name)) {
        throw kerror(kerror.type.Parsing, 'circular-dependency', {
          message: `Circular dependency detected: ${name}`,
          context: {
            dependency: name,
            url: dep.url,
          },
        })
      }
      return
    }

    this.visited.add(name)

    // Get the latest version if not specified
    const version = dep.version || await getLatestCommit(dep.url)

    // Create the node
    const node: DependencyNode = {
      name,
      url: dep.url,
      version,
      extract: dep.extract,
      requires: [],
    }

    // TODO: Parse the dependency's own klep.deps file to get its requirements
    // For now, we'll just add it to the graph
    this.graph.set(name, node)
    this.resolved.add(name)
  }
} 