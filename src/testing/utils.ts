export function to<T>(value: unknown): T {
  return value as T;
}

export type State<T> = [() => T, SetState<T>, ResetState];
type SetState<S> = (value: S | ((value: S) => S)) => void;
type ResetState = () => void;

// Simple state management that creates shared state objects
const stateRegistry = new Map<string, unknown>();
let stateIdCounter = 0;

export function useState<T>(initialValue: T): [() => T, SetState<T>, ResetState] {
  const stateId = `state_${++stateIdCounter}`;

  if (!stateRegistry.has(stateId)) {
    stateRegistry.set(stateId, initialValue);
  }

  return [
    () => stateRegistry.get(stateId), // Getter function that always returns current value
    (newValue) => {
      const currentValue = stateRegistry.get(stateId);
      stateRegistry.set(stateId, newValue instanceof Function ? newValue(currentValue) : newValue);
    },
    () => stateRegistry.set(stateId, initialValue),
  ];
}
