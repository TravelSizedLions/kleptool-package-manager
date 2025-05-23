import { lockedDependency } from './dependency.schema.ts'

export const klepKeepfileSchema = {
  $id: 'gimme.lock.schema',
  title: 'Gimme Lockfile',
  description: 'Gimme lockfile schema.',
  type: 'object',
  definitions: {
    lockedDependency: lockedDependency,
  },
  additionalProperties: {
    $ref: '#/definitions/lockedDependency',
  },
}
