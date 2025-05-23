import fs from 'node:fs'
import path from 'node:path'
import kerror from './kerror.ts'
import json5 from 'json5'
import { DependencyGraph } from './schemas/klep.keep.schema.ts'
import process from "node:process";

const DEFAULT_KEEP_FILE: DependencyGraph = []

function initialize() {
  if (fs.existsSync(path.join(process.cwd(), 'klep.keep'))) {
    throw kerror(kerror.type.Parsing, 'klep-file-exists', {
      message: 'A klep.keep file already exists in the current directory',
    });
  }

  fs.writeFileSync(path.join(process.cwd(), 'klep.keep'), json5.stringify(DEFAULT_KEEP_FILE, null, 2));
}

export default {
  initialize,
}