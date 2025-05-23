export const klepDepsSchema = {
  $id: 'klep.deps.schema',
  title: 'Klep Dependencies',
  description: 'Klep dependencies configuration file.',
  type: 'object',
  definitions: {
    extractRule: {
      description: 'Extract rules for the dependency',
      oneOf: [
        {
          type: 'string',
          enum: ['all']
        },
        {
          type: 'object',
          additionalProperties: {
            type: 'string'
          }
        }
      ],
    },
    dependency: {
      description: 'Individual dependency entry',
      type: 'object',
      required: ['url'],
      properties: {
        url: {
          type: 'string',
          description: 'URL of the dependency'
        },
        folder: {
          type: 'string',
          description: 'Folder to extract the dependency to'
        },
        version: {
          type: 'string',
          description: 'Version of the dependency',
          default: 'latest'
        },
        extract: {
          $ref: '#/definitions/extractRule'
        }
      },
      additionalProperties: false
    }
  },
  properties: {
    dependencyFolder: {
      type: 'string',
      description: 'Path to the dependencies folder for your project. Defaults to .dependencies',
      default: '.dependencies'
    },
    dependencies: {
      description: 'Map of dependencies. Each dependency must have a unique name and cannot conflict with development dependencies.',
      type: 'object',
      additionalProperties: {
        $ref: '#/definitions/dependency'
      }
    },
    devDependencies: {
      description: 'Map of development dependencies. Each dependency must have a unique name and cannot conflict with core dependencies.',
      type: 'object',
      additionalProperties: {
        $ref: '#/definitions/dependency'
      }
    }
  },
  required: ['dependencies']
}
