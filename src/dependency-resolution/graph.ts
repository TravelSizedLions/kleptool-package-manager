import { DependencyGraph } from '../schemas/klep.keep.schema.ts';
import keepfile from '../keepfile.ts';
import _ from 'es-toolkit';


type SATNode = {
  name: string;
  dependencies: string[];
}

type SATEdge = {
  from: string;
  to: string;
}

function create() {
  return keepfile.clone();
}

function clone(graph: DependencyGraph): DependencyGraph {
  return _.cloneDeep(graph);
}

function toSAT(graph: DependencyGraph) {
  return graph.map((node) => {
    
  });
}

export default {
  clone,
};
