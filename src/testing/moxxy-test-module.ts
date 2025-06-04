// Test module for moxxy unit tests - various export patterns

// Default function export
export default function defaultFunction(arg: string) {
  return `default-${arg}`;
}

// Named function export
export function namedFunction(arg: string) {
  return `named-${arg}`;
}

// Named constant export
export const namedConstant = 'test-constant';

// Object with methods export
export const testObject = {
  method1(arg: string) {
    return `method1-${arg}`;
  },
  method2(arg: string) {
    return `method2-${arg}`;
  },
  property: 'test-property',
};

// Class export
export class TestClass {
  constructor(public value: string) {}

  getValue() {
    return this.value;
  }
}

// Namespace-style export
export const namespace = {
  nested: {
    deep: {
      func(arg: string) {
        return `deep-${arg}`;
      },
    },
  },
};
