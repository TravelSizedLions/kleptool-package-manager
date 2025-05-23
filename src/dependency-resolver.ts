import { getVersionType } from './git.ts'
import { compareVersionSafety, getSafetyWarning } from './version-safety.ts'
import { KlepError } from './errors.ts'
import semver from 'semver'
import { addDependency, Dependency, loadDeps, saveDeps } from './klep.ts'
import fs from 'node:fs'

// Types
export type VersionConstraint = {
  type: 'semver' | 'branch' | 'tag' | 'hash'
  value: string
  constraint?: '^' | '~' | '<' | '>=' | '<=' | '!='
}

export type DependencyConflict = {
  name: string
  requested: VersionConstraint
  existing: VersionConstraint
  resolution: VersionConstraint
}

export type DependencyResolution = {
  name: string
  url: string
  version: VersionConstraint
  warnings: string[]
  conflicts: DependencyConflict[]
}

export type DependencyInstallResult = {
  success: boolean
  warnings: string[]
  error?: string
  resolution?: DependencyResolution
}

// Dependency Graph Types
export type DependencyNode = {
  name: string
  url: string
  version: VersionConstraint
  dependencies: Record<string, DependencyNode>
  keepfile?: Record<string, any>
  warnings: string[]
  conflicts: DependencyConflict[]
}

export type DependencyGraph = {
  root: DependencyNode
  nodes: Map<string, DependencyNode>
}

export type ResolutionAttempt = {
  node: DependencyNode
  version: VersionConstraint
  conflicts: DependencyConflict[]
}

// Version Constraint Parsing
function parseVersionConstraint(version: string): VersionConstraint {
  if (version === 'latest') {
    return {
      type: 'hash',
      value: 'latest',
    }
  }

  const constraints = ['^', '~', '<', '>=', '<=', '!=']
  const constraint = constraints.find((c) => version.startsWith(c))
  const value = constraint ? version.slice(constraint.length) : version

  if (semver.valid(value)) {
    return {
      type: 'semver',
      value,
      constraint: constraint as VersionConstraint['constraint'],
    }
  }

  return {
    type: 'branch', // Placeholder, will be updated by resolveVersionConstraint
    value,
    constraint: constraint as VersionConstraint['constraint'],
  }
}

// Version Resolution
export async function resolveVersionConstraint(
  url: string,
  version: string
): Promise<VersionConstraint> {
  const constraint = parseVersionConstraint(version)
  const actualType = await getVersionType(url, constraint.value)

  return {
    ...constraint,
    type: actualType,
  }
}

// Constraint Satisfaction
function satisfiesSemverConstraint(
  version: VersionConstraint,
  constraint: VersionConstraint
): boolean {
  if (!constraint.constraint) {
    return version.value === constraint.value
  }
  return semver.satisfies(
    version.value,
    constraint.constraint + constraint.value
  )
}

export function satisfiesConstraint(
  version: VersionConstraint,
  constraint: VersionConstraint
): boolean {
  if (version.type !== constraint.type) {
    return false
  }

  if (version.value === 'latest' || constraint.value === 'latest') {
    return version.value === constraint.value
  }

  switch (version.type) {
    case 'semver':
      return satisfiesSemverConstraint(version, constraint)
    case 'hash':
    case 'tag':
    case 'branch':
      return version.value === constraint.value
  }
}

// Conflict Resolution
function isSemverBreakingChange(
  requested: VersionConstraint,
  existing: VersionConstraint
): boolean {
  const requestedVersion = semver.parse(requested.value)
  const existingVersion = semver.parse(existing.value)
  return requestedVersion && existingVersion
    ? requestedVersion.major !== existingVersion.major
    : false
}

function isHardConflict(conflict: DependencyConflict): boolean {
  if (conflict.requested.type !== conflict.existing.type) {
    return true
  }

  if (conflict.requested.type === 'semver') {
    return isSemverBreakingChange(conflict.requested, conflict.existing)
  }

  const safetyDiff = compareVersionSafety(
    conflict.requested.type,
    conflict.existing.type
  )

  return (
    safetyDiff === 0 && conflict.requested.value !== conflict.existing.value
  )
}

function resolveLatestConflict(
  name: string,
  requested: VersionConstraint,
  existing: VersionConstraint
): DependencyConflict {
  return requested.value === 'latest'
    ? {
        name,
        requested,
        existing,
        resolution: existing,
      }
    : {
        name,
        requested,
        existing,
        resolution: requested,
      }
}

export function resolveConflict(
  name: string,
  requested: VersionConstraint,
  existing: VersionConstraint
): DependencyConflict {
  if (requested.value === existing.value && requested.type === existing.type) {
    return {
      name,
      requested,
      existing,
      resolution: requested,
    }
  }

  if (requested.value === 'latest' || existing.value === 'latest') {
    return resolveLatestConflict(name, requested, existing)
  }

  const safetyDiff = compareVersionSafety(requested.type, existing.type)
  return {
    name,
    requested,
    existing,
    resolution: safetyDiff >= 0 ? requested : existing,
  }
}

// Dependency Installation
function createConflictWarning(
  name: string,
  newVersion: VersionConstraint,
  conflict: DependencyConflict,
  existingName: string
): string {
  return `Version conflict for ${name}: requested ${newVersion.value} but using ${conflict.resolution.value} from ${existingName}`
}

function createSoftConflictWarning(
  name: string,
  conflict: DependencyConflict
): string {
  return `Soft conflict for ${name}: using ${conflict.resolution.value} instead of ${conflict.requested.value}`
}

function createHardConflictError(
  name: string,
  hardConflicts: DependencyConflict[]
): string {
  return `Hard conflicts found for ${name}:\n${hardConflicts
    .map(
      (c) =>
        `- ${c.name}: requested ${c.requested.value} but ${c.existing.value} is required`
    )
    .join('\n')}`
}

async function checkExistingDependency(
  name: string,
  newDep: Dependency,
  newVersion: VersionConstraint,
  existingName: string,
  existingDep: Dependency
): Promise<DependencyConflict | null> {
  if (existingDep.url !== newDep.url) {
    return null
  }

  const existingVersion = await resolveVersionConstraint(
    existingDep.url,
    existingDep.version || 'latest'
  )

  if (satisfiesConstraint(newVersion, existingVersion)) {
    return null
  }

  return resolveConflict(name, newVersion, existingVersion)
}

export async function checkDependencyConflicts(
  name: string,
  newDep: Dependency,
  existingDeps: Record<string, Dependency>
): Promise<DependencyResolution> {
  const warnings: string[] = []
  const conflicts: DependencyConflict[] = []

  const newVersion = await resolveVersionConstraint(
    newDep.url,
    newDep.version || 'latest'
  )

  const warning = getSafetyWarning(newVersion.type)
  if (warning) {
    warnings.push(warning)
  }

  for (const [existingName, existingDep] of Object.entries(existingDeps)) {
    const conflict = await checkExistingDependency(
      name,
      newDep,
      newVersion,
      existingName,
      existingDep
    )

    if (conflict) {
      conflicts.push(conflict)
      if (conflict.resolution.value !== newVersion.value) {
        warnings.push(
          createConflictWarning(name, newVersion, conflict, existingName)
        )
      }
    }
  }

  return {
    name,
    url: newDep.url,
    version: newVersion,
    warnings,
    conflicts,
  }
}

export async function installDependency(
  name: string,
  dep: Dependency
): Promise<DependencyInstallResult> {
  const warnings: string[] = []

  try {
    const deps = loadDeps()
    if (!deps) {
      throw new KlepError({
        type: 'parsing',
        id: 'no-deps-file',
        message: 'No klep.deps file found',
      })
    }

    const resolution = await checkDependencyConflicts(
      name,
      dep,
      deps.dependencies || {}
    )

    const hardConflicts = resolution.conflicts.filter(isHardConflict)
    if (hardConflicts.length > 0) {
      return {
        success: false,
        warnings,
        error: createHardConflictError(name, hardConflicts),
      }
    }

    resolution.conflicts.forEach((conflict) => {
      if (!isHardConflict(conflict)) {
        warnings.push(createSoftConflictWarning(name, conflict))
      }
    })

    addDependency(name, {
      ...dep,
      version: resolution.version.value,
    })
    saveDeps()

    const keepfile = generateKeepfile({
      [name]: resolution,
    })
    fs.writeFileSync('./klep.keep', JSON.stringify(keepfile, null, 2))

    return {
      success: true,
      warnings: [...warnings, ...resolution.warnings],
      resolution,
    }
  } catch (error) {
    return {
      success: false,
      warnings,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    }
  }
}

// Keepfile Generation
export function generateKeepfile(
  resolutions: Record<string, DependencyResolution>
): Record<string, any> {
  const keepfile: Record<string, any> = {
    dependencies: {},
  }

  for (const [name, resolution] of Object.entries(resolutions)) {
    keepfile.dependencies[name] = {
      url: resolution.url,
      version: resolution.version.value,
      type: resolution.version.type,
      warnings: resolution.warnings,
    }
  }

  return keepfile
}

// Dependency Graph Building
async function loadKeepfile(
  url: string,
  version: VersionConstraint
): Promise<Record<string, any> | null> {
  // TODO: Implement git checkout of specific version and reading keepfile
  // This would need to:
  // 1. Clone the repo if not already present
  // 2. Checkout the specific version
  // 3. Read and parse the keepfile
  // 4. Return null if no keepfile exists
  return null
}

async function buildDependencyNode(
  name: string,
  url: string,
  version: VersionConstraint,
  visited: Set<string>
): Promise<DependencyNode> {
  const node: DependencyNode = {
    name,
    url,
    version,
    dependencies: {},
    warnings: [],
    conflicts: [],
  }

  // Prevent infinite recursion
  const nodeKey = `${url}@${version.value}`
  if (visited.has(nodeKey)) {
    return node
  }
  visited.add(nodeKey)

  // Load keepfile for this version
  const keepfile = await loadKeepfile(url, version)
  if (keepfile?.dependencies) {
    node.keepfile = keepfile

    // Recursively build dependency tree
    for (const [depName, dep] of Object.entries(keepfile.dependencies)) {
      const depVersion = await resolveVersionConstraint(dep.url, dep.version)
      node.dependencies[depName] = await buildDependencyNode(
        depName,
        dep.url,
        depVersion,
        visited
      )
    }
  }

  return node
}

export async function buildDependencyGraph(
  rootName: string,
  rootUrl: string,
  rootVersion: string
): Promise<DependencyGraph> {
  const rootVersionConstraint = await resolveVersionConstraint(
    rootUrl,
    rootVersion
  )
  const root = await buildDependencyNode(
    rootName,
    rootUrl,
    rootVersionConstraint,
    new Set()
  )

  const nodes = new Map<string, DependencyNode>()
  const queue = [root]

  while (queue.length > 0) {
    const node = queue.shift()!
    nodes.set(`${node.url}@${node.version.value}`, node)
    queue.push(...Object.values(node.dependencies))
  }

  return { root, nodes }
}

// SAT Solving
function findConflicts(
  node: DependencyNode,
  visited: Set<string> = new Set()
): DependencyConflict[] {
  const conflicts: DependencyConflict[] = []
  const nodeKey = `${node.url}@${node.version.value}`

  if (visited.has(nodeKey)) {
    return conflicts
  }
  visited.add(nodeKey)

  // Check conflicts with direct dependencies
  for (const [depName, dep] of Object.entries(node.dependencies)) {
    const conflict = resolveConflict(depName, dep.version, node.version)
    if (conflict.resolution.value !== dep.version.value) {
      conflicts.push(conflict)
    }
  }

  // Recursively check conflicts in dependencies
  for (const dep of Object.values(node.dependencies)) {
    conflicts.push(...findConflicts(dep, visited))
  }

  return conflicts
}

function generateResolutionAttempts(
  node: DependencyNode,
  visited: Set<string> = new Set()
): ResolutionAttempt[] {
  const attempts: ResolutionAttempt[] = []
  const nodeKey = `${node.url}@${node.version.value}`

  if (visited.has(nodeKey)) {
    return attempts
  }
  visited.add(nodeKey)

  // Generate attempts for this node
  attempts.push({
    node,
    version: node.version,
    conflicts: findConflicts(node),
  })

  // Recursively generate attempts for dependencies
  for (const dep of Object.values(node.dependencies)) {
    attempts.push(...generateResolutionAttempts(dep, visited))
  }

  return attempts
}

async function tryResolveDependency(
  graph: DependencyGraph,
  attempt: ResolutionAttempt
): Promise<boolean> {
  // TODO: Implement version resolution attempt
  // This would need to:
  // 1. Checkout the attempted version
  // 2. Rebuild the dependency graph for that version
  // 3. Check for conflicts
  // 4. Return true if resolution successful
  return false
}

export async function resolveDependencyGraph(
  graph: DependencyGraph
): Promise<DependencyResolution[]> {
  const attempts = generateResolutionAttempts(graph.root)
  const resolutions: DependencyResolution[] = []

  for (const attempt of attempts) {
    if (await tryResolveDependency(graph, attempt)) {
      resolutions.push({
        name: attempt.node.name,
        url: attempt.node.url,
        version: attempt.version,
        warnings: attempt.node.warnings,
        conflicts: attempt.conflicts,
      })
    }
  }

  return resolutions
}
