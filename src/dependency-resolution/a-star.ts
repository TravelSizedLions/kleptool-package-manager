// Types for our A* implementation
type Node<T> = T;
type Edge<T> = {
  from: Node<T>;
  to: Node<T>;
  cost: number;
};

type HeuristicFn<T> = (node: Node<T>, goal: Node<T>) => number;
type DistanceFn<T> = (from: Node<T>, to: Node<T>) => number;
type NeighborFn<T> = (node: Node<T>) => Edge<T>[];

// Priority queue implementation using a binary heap
class PriorityQueue<T> {
  private items: { item: T; priority: number }[] = [];

  enqueue(item: T, priority: number): void {
    this.items.push({ item, priority });
    this.items.sort((a, b) => a.priority - b.priority);
  }

  dequeue(): T | undefined {
    return this.items.shift()?.item;
  }

  isEmpty(): boolean {
    return this.items.length === 0;
  }

  has(item: T): boolean {
    return this.items.some(({ item: i }) => i === item);
  }

  updatePriority(item: T, newPriority: number): void {
    const index = this.items.findIndex(({ item: i }) => i === item);
    if (index !== -1) {
      this.items[index].priority = newPriority;
      this.items.sort((a, b) => a.priority - b.priority);
    }
  }
}

// Core A* implementation
export const findPath = <T>(
  start: Node<T>,
  goal: Node<T>,
  heuristic: HeuristicFn<T>,
  distance: DistanceFn<T>,
  getNeighbors: NeighborFn<T>
): Node<T>[] => {
  // Initialize data structures
  const openSet = new PriorityQueue<Node<T>>();
  const closedSet = new Set<Node<T>>();
  const cameFrom = new Map<Node<T>, Node<T>>();
  const gScore = new Map<Node<T>, number>();
  const fScore = new Map<Node<T>, number>();

  // Helper functions
  const reconstructPath = (current: Node<T>): Node<T>[] => {
    const path: Node<T>[] = [current];
    let node = current;
    while (cameFrom.has(node)) {
      node = cameFrom.get(node)!;
      path.unshift(node);
    }
    return path;
  };

  // Initialize start node
  gScore.set(start, 0);
  fScore.set(start, heuristic(start, goal));
  openSet.enqueue(start, fScore.get(start)!);

  // Main A* loop
  while (!openSet.isEmpty()) {
    const current = openSet.dequeue()!;

    if (current === goal) {
      return reconstructPath(current);
    }

    closedSet.add(current);

    // Process neighbors
    for (const edge of getNeighbors(current)) {
      const neighbor = edge.to;

      if (closedSet.has(neighbor)) {
        continue;
      }

      const tentativeGScore = gScore.get(current)! + edge.cost;

      if (!openSet.has(neighbor)) {
        openSet.enqueue(neighbor, Infinity);
      } else if (tentativeGScore >= (gScore.get(neighbor) ?? Infinity)) {
        continue;
      }

      // This path is the best so far
      cameFrom.set(neighbor, current);
      gScore.set(neighbor, tentativeGScore);
      fScore.set(neighbor, tentativeGScore + heuristic(neighbor, goal));
      openSet.updatePriority(neighbor, fScore.get(neighbor)!);
    }
  }

  // No path found
  return [];
};

// Helper function to create an A* solver with specific functions
export const createAStarSolver = <T>(
  heuristic: HeuristicFn<T>,
  distance: DistanceFn<T>,
  getNeighbors: NeighborFn<T>
) => {
  return (start: Node<T>, goal: Node<T>) =>
    findPath(start, goal, heuristic, distance, getNeighbors);
}; 