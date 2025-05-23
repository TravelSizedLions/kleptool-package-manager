export const dependencyBaseSchema = {
  type: 'object',
  properties: {
    url: {
      type: 'string',
      description: 'Dependency url',
    },
    folder: {
      type: 'string',
      description: 'Dependency folder',
    },
    extract: {
      type: ['object', 'string'],
      description: 'Extract rules',
      default: 'all',
    },
  },
  required: ['url'],
  additionalProperties: false,
}

export const dependency = {
  ...dependencyBaseSchema,
  properties: {
    ...dependencyBaseSchema.properties,
    version: {
      type: 'string',
      description: 'Dependency version',
      default: 'latest',
    },
  },
}

export const lockedDependency = {
  ...dependencyBaseSchema,
  properties: {
    ...dependencyBaseSchema.properties,
    requested: {
      type: 'array',
      description: 'Available dependency versions',
    },
    resolved: {
      type: 'string',
      description: 'Resolved dependency version',
    },
    dependencies: {
      type: 'array',
      description: 'Subdependencies',
    },
  },
}
