// Target module that uses imports - this is what we'll test mocking on

import defaultFunction from './moxxy-test-module.ts';
import {
  namedFunction,
  namedConstant,
  testObject,
  TestClass,
  namespace,
} from './moxxy-test-module.ts';

// Functions that use the imports
export function useDefault(arg: string) {
  return defaultFunction(arg);
}

export function useNamed(arg: string) {
  return namedFunction(arg);
}

export function useConstant() {
  return namedConstant;
}

export function useObjectMethod(arg: string) {
  return testObject.method1(arg);
}

export function useObjectProperty() {
  return testObject.property;
}

export function useClass(value: string) {
  const instance = new TestClass(value);
  return instance.getValue();
}

export function useNamespace(arg: string) {
  return namespace.nested.deep.func(arg);
}
