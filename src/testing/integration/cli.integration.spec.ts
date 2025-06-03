import { describe, it, expect } from 'bun:test';
import { $ } from 'bun';


describe('CLI', () => {
  it('should run a task', async () => {
    const result = await $`klep test`;
    expect(result.exitCode).toBe(0);
  });

  it('should run a task with args', async () => {
    const result = await $`klep test --arg=1`;
    expect(result.exitCode).toBe(0);
  });
});