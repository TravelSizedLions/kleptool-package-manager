import { dependency } from "./dependency.schema.ts"

export const klepDepsSchema = {
  $id: "klep.deps.schema",
  title: "Klep Dependencies",
  description: "Klep dependencies configuration file.",
  type: "object",
  definitions: {
    dependency: dependency,
  },
  properties: {
    path: {
      type: "string",
      description: "Path to the dependencies folder for your project. Doesn't need to be explicitly specified unless you are doing something non-standard.",
      default: "deps"
    },
    dependencies: {
      type: "object",
      description: "Map of dependencies. Because dependencies can share the same url, a unique name is required for each dependency.",
      additionalProperties: {
        $ref: "#/definitions/dependency"
      }
    },
    devDependencies: {
      type: "object",
      description: "Map of development dependencies.",
      additionalProperties: {
        $ref: "#/definitions/dependency"
      }
    }
  },
  required: ["dependencies"]
}