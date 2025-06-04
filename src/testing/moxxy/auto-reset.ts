import { beforeEach } from 'bun:test';

type This = { moxxy?: { reset: () => void } };

beforeEach(() => (globalThis as This).moxxy?.reset());
