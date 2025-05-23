export const klepKeepfileSchema = {
  $id: 'klep.keep.schema',
  title: 'Klep Keepfile',
  description: 'Klep keepfile schema for resolved dependencies.',
  type: 'array',
  definitions: {
    extractRule: {
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
      ]
    },
    requestedVersion: {
      type: 'object',
      required: ['version'],
      properties: {
        version: {
          type: 'string',
          description: 'Requested version of the dependency'
        },
        extract: {
          $ref: '#/definitions/extractRule'
        }
      }
    },
    requiredDependency: {
      type: 'object',
      required: ['name', 'version'],
      properties: {
        name: {
          type: 'string',
          description: 'Name of the required dependency'
        },
        version: {
          type: 'string',
          description: 'Version of the required dependency'
        },
        extract: {
          $ref: '#/definitions/extractRule'
        }
      }
    },
    resolvedVersion: {
      type: 'object',
      required: ['version', 'extract', 'requires'],
      properties: {
        version: {
          type: 'string',
          description: 'Resolved version of the dependency'
        },
        extract: {
          $ref: '#/definitions/extractRule'
        },
        requires: {
          type: 'array',
          items: {
            $ref: '#/definitions/requiredDependency'
          }
        }
      }
    },
    resolvedDependency: {
      type: 'object',
      required: ['name', 'requested', 'resolved'],
      properties: {
        name: {
          type: 'string',
          description: 'Name of the dependency'
        },
        requested: {
          type: 'array',
          items: {
            $ref: '#/definitions/requestedVersion'
          }
        },
        resolved: {
          $ref: '#/definitions/resolvedVersion'
        }
      }
    }
  },
  items: {
    $ref: '#/definitions/resolvedDependency'
  }
}
