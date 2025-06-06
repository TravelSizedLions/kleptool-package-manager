// quality-allow max-function-length 150 file
// quality-allow max-cyclomatic-complexity 12 file

import { describe, it, expect } from 'bun:test';
import processModule from './process.ts';

// Helper functions for common mocking patterns
function __createExecMock(
  options: {
    stdout?: string;
    stderr?: string;
    exitCode?: number;
    captureCommand?: (command: string) => void;
    captureOptions?: (options: any) => void;
  } = {}
) {
  const { stdout = '', stderr = '', exitCode = 0, captureCommand, captureOptions } = options;

  return (command: string, opts: any) => {
    captureCommand?.(command);
    captureOptions?.(opts);

    return {
      stdout: {
        on: (event: string, handler: (...args: unknown[]) => void) => {
          if (event === 'data') setTimeout(() => handler(stdout), 10);
          else if (event === 'end') setTimeout(() => handler(), 20);
        },
        pipe: () => {},
      },
      stderr: {
        on: (event: string, handler: (...args: unknown[]) => void) => {
          if (event === 'data') setTimeout(() => handler(stderr), 10);
          else if (event === 'end') setTimeout(() => handler(), 20);
        },
        pipe: () => {},
      },
      on: (event: string, handler: (...args: unknown[]) => void) => {
        if (event === 'close') setTimeout(() => handler(exitCode), 30);
      },
      stdin: { write: () => {}, end: () => {} },
      kill: () => {},
    };
  };
}

function __createSpawnIPCMock(
  options: {
    ipcData?: string;
    exitCode?: number;
    errorOnEvent?: string;
  } = {}
) {
  const { ipcData = '', exitCode = 0, errorOnEvent } = options;

  return () => ({
    stdio: [
      null, // stdin
      null, // stdout
      null, // stderr
      {
        // fd3 for IPC
        on: (event: string, handler: (...args: unknown[]) => void) => {
          if (event === 'data') setTimeout(() => handler(ipcData), 10);
          else if (event === 'end') setTimeout(() => handler(), 20);
        },
      },
    ],
    on: (event: string, handler: (...args: unknown[]) => void) => {
      if (event === 'close') setTimeout(() => handler(exitCode), 30);
      else if (event === errorOnEvent && errorOnEvent)
        setTimeout(() => handler(new Error('Process error')), 5);
    },
    stdin: { write: () => {}, end: () => {} },
    kill: () => {},
  });
}

function __createHangingProcessMock(
  options: {
    onKill?: () => void;
  } = {}
) {
  const { onKill } = options;

  return () => ({
    stdout: {
      on: () => {}, // Never calls handlers - hangs forever
      pipe: () => {},
    },
    stderr: {
      on: () => {},
      pipe: () => {},
    },
    on: () => {}, // Never calls close handler
    stdin: { write: () => {}, end: () => {} },
    stdio: [
      null, // stdin
      null, // stdout
      null, // stderr
      {
        // fd3 for IPC - also hangs forever
        on: () => {},
        pipe: () => {},
      },
    ],
    kill: () => onKill?.(),
  });
}

function __createErrorMock(errorMessage: string) {
  return () => {
    throw new Error(errorMessage);
  };
}

function __createStreamingMock(
  options: {
    captureEnv?: (env: any) => void;
    captureStreamingCalls?: (stdout: boolean, stderr: boolean) => void;
    exitCode?: number;
  } = {}
) {
  const { captureEnv, captureStreamingCalls, exitCode = 0 } = options;

  return (command: string, opts: any) => {
    captureEnv?.(opts.env);

    const mock = {
      stdout: {
        on: (event: string, handler: (...args: unknown[]) => void) => {
          if (event === 'data') setTimeout(() => handler('test\n'), 10);
          else if (event === 'end') setTimeout(() => handler(), 20);
        },
        pipe: () => {
          captureStreamingCalls?.(true, false);
        },
      },
      stderr: {
        on: (event: string, handler: (...args: unknown[]) => void) => {
          if (event === 'end') setTimeout(() => handler(), 20);
        },
        pipe: () => {
          captureStreamingCalls?.(false, true);
        },
      },
      on: (event: string, handler: (...args: unknown[]) => void) => {
        if (event === 'close') setTimeout(() => handler(exitCode), 30);
      },
      stdin: { write: () => {}, end: () => {} },
      kill: () => {},
    };

    return mock;
  };
}

async function __testColorPreservation(options: {
  preserveColors?: boolean;
  streamOutput?: boolean;
  inputEnv: Record<string, string>;
  expectedEnv: Record<string, string>;
}) {
  let capturedEnv = {};

  moxxy.exec.mock(
    __createExecMock({
      stdout: 'test\n',
      captureOptions: (opts) => {
        capturedEnv = opts.env;
      },
    })
  );

  await processModule.execWithResult('echo test', {
    preserveColors: options.preserveColors,
    streamOutput: options.streamOutput,
    env: options.inputEnv,
  });

  expect(capturedEnv).toEqual(options.expectedEnv);
}

async function __testEnvironmentHandling(
  inputEnv: Record<string, string>,
  expectedEnv: Record<string, string>,
  preserveColors = true
) {
  let capturedEnv = {};

  moxxy.exec.mock(
    __createStreamingMock({
      captureEnv: (env) => {
        capturedEnv = env;
      },
    })
  );

  await processModule.execWithResult('echo test', {
    preserveColors,
    env: inputEnv,
  });

  expect(capturedEnv).toEqual(expectedEnv);
}

async function __testIpcScenario(
  mockOptions: Parameters<typeof __createSpawnIPCMock>[0],
  shouldThrow = false,
  expectedErrorProperties?: { type: string; id: string }
) {
  moxxy.spawn.mock(() => __createSpawnIPCMock(mockOptions)());

  if (shouldThrow) {
    try {
      await processModule.ipc('test-command');
      expect(true).toBe(false); // Should not reach here
    } catch (error: any) {
      if (expectedErrorProperties) {
        expect(error.type).toBe(expectedErrorProperties.type);
        expect(error.id).toBe(expectedErrorProperties.id);
      }
    }
  } else {
    const result = await processModule.ipc('test-command', {
      data: 'input data',
      args: ['arg1', 'arg2'],
    });
    expect(result).toBe(mockOptions?.ipcData || '');
  }
}

async function __testExecResultScenario(
  command: string,
  options: {
    mockOptions: Parameters<typeof __createExecMock>[0];
    execOptions?: any;
    expectedResult: {
      success?: boolean;
      exitCode?: number;
      stdout?: string;
      stderr?: string;
    };
  }
) {
  const { mockOptions, execOptions = {}, expectedResult } = options;

  moxxy.exec.mock(__createExecMock(mockOptions));
  const result = await processModule.execWithResult(command, execOptions);

  if (expectedResult.success !== undefined) expect(result.success).toBe(expectedResult.success);
  if (expectedResult.exitCode !== undefined) expect(result.exitCode).toBe(expectedResult.exitCode);
  if (expectedResult.stdout !== undefined) expect(result.stdout).toBe(expectedResult.stdout);
  if (expectedResult.stderr !== undefined) expect(result.stderr).toBe(expectedResult.stderr);
}

describe('exec', () => {
  it('should execute a command', async () => {
    moxxy.exec.mock(
      __createExecMock({
        stdout: 'Hello, world!\n',
      })
    );

    const result = await processModule.exec('echo "Hello, world!"');
    expect(result).toBe('Hello, world!\n');
  });

  it('should substitute $@ with arguments cross-platform', async () => {
    let capturedCommand = '';

    moxxy.exec.mock(
      __createExecMock({
        stdout: 'Args: hello world\n',
        captureCommand: (cmd) => {
          capturedCommand = cmd;
        },
      })
    );

    const result = await processModule.execWithResult('echo "Args: $@"', {
      args: ['hello', 'world'],
      throwOnError: false,
    });

    expect(result.success).toBe(true);
    expect(capturedCommand).toBe('echo "Args: hello world"');
    expect(result.stdout).toBe('Args: hello world\n');
  });
});

describe('color preservation', () => {
  it('should preserve original environment when colors are disabled', async () => {
    await __testColorPreservation({
      preserveColors: false,
      inputEnv: { ORIGINAL: 'value' },
      expectedEnv: { ORIGINAL: 'value' },
    });
  });

  it('should add color environment variables when colors are enabled', async () => {
    await __testColorPreservation({
      preserveColors: true,
      inputEnv: { ORIGINAL: 'value' },
      expectedEnv: {
        ORIGINAL: 'value',
        FORCE_COLOR: '1',
        TERM: 'xterm-256color',
      },
    });
  });

  it('should preserve existing TERM variable when colors are enabled', async () => {
    await __testColorPreservation({
      preserveColors: true,
      inputEnv: { TERM: 'screen-256color' },
      expectedEnv: {
        TERM: 'screen-256color',
        FORCE_COLOR: '1',
      },
    });
  });

  it('should enable colors for streamOutput even when preserveColors is false', async () => {
    await __testColorPreservation({
      preserveColors: false,
      streamOutput: true,
      inputEnv: { ORIGINAL: 'value' },
      expectedEnv: {
        ORIGINAL: 'value',
        FORCE_COLOR: '1',
        TERM: 'xterm-256color',
      },
    });
  });

  it('should respect NO_COLOR environment variable in subprocess env', async () => {
    await __testEnvironmentHandling(
      { NO_COLOR: '1', ORIGINAL: 'value' },
      { NO_COLOR: '1', ORIGINAL: 'value' }
    );
  });

  it('should respect CI environment variable in subprocess env', async () => {
    await __testEnvironmentHandling(
      { CI: 'true', ORIGINAL: 'value' },
      { CI: 'true', ORIGINAL: 'value' }
    );
  });
});

describe('ipc', () => {
  it('should handle basic IPC communication', async () => {
    await __testIpcScenario({ ipcData: 'IPC response data' });
  });

  it('should handle IPC command failure', async () => {
    await __testIpcScenario({ exitCode: 1 }, true, { type: 'Unknown', id: 'ipc-error-unknown' });
  });

  it('should handle IPC with timeout', async () => {
    let killCalled = false;

    moxxy.spawn.mock(() =>
      __createHangingProcessMock({
        onKill: () => {
          killCalled = true;
        },
      })()
    );

    try {
      await processModule.ipc('hanging-command', { timeout: 100 });
      expect(true).toBe(false);
    } catch (error: any) {
      expect(error.type).toBe('Unknown');
      expect(error.id).toBe('ipc-error-unknown');
      expect(killCalled).toBe(true);
    }
  });

  it('should handle IPC process errors', async () => {
    await __testIpcScenario({ errorOnEvent: 'error' }, true, {
      type: 'Unknown',
      id: 'ipc-error-unknown',
    });
  });

  it('should handle IPC with unknown errors', async () => {
    moxxy.spawn.mock(__createErrorMock('Spawn failed completely'));

    try {
      await processModule.ipc('command');
      expect(true).toBe(false);
    } catch (error: any) {
      expect(error.type).toBe('Unknown');
      expect(error.id).toBe('ipc-error-unknown');
    }
  });
});

describe('execWithResult', () => {
  it('should handle exec failure with throwOnError disabled', async () => {
    await __testExecResultScenario('failing-command', {
      mockOptions: {
        stdout: 'output',
        stderr: 'error output',
        exitCode: 1,
      },
      execOptions: { throwOnError: false },
      expectedResult: {
        success: false,
        exitCode: 1,
        stdout: 'output',
        stderr: 'error output',
      },
    });
  });

  it('should handle exec failure with throwOnError enabled', async () => {
    await __testExecResultScenario('failing-command', {
      mockOptions: { exitCode: 1 },
      execOptions: { throwOnError: true },
      expectedResult: {
        success: false,
        exitCode: 1,
      },
    });
  });

  it('should handle streamOutput with colors', async () => {
    let spawnCalled = false;
    let spawnOptions: any = {};

    moxxy.spawn.mock((cmdName: string, cmdArgs: string[], options: any) => {
      spawnCalled = true;
      spawnOptions = options;
      return {
        on: (event: string, handler: (...args: unknown[]) => void) => {
          if (event === 'close') setTimeout(() => handler(0), 30);
        },
        kill: () => {},
      };
    });

    const result = await processModule.execWithResult('echo test', {
      streamOutput: true,
      preserveColors: true,
    });

    expect(spawnCalled).toBe(true);
    expect(spawnOptions.stdio).toBe('inherit');
    expect(result.stdout).toBe('[streamed to console with colors]');
    expect(result.stderr).toBe('[streamed to console with colors]');
    expect(result.success).toBe(true);
  });

  it('should handle process timeout', async () => {
    let killCalled = false;

    moxxy.exec.mock(() =>
      __createHangingProcessMock({
        onKill: () => {
          killCalled = true;
        },
      })()
    );

    try {
      await processModule.execWithResult('hanging-command', {
        timeout: 100,
        throwOnError: true,
      });
      expect(true).toBe(false);
    } catch (error: any) {
      expect(error.type).toBe('Unknown');
      expect(error.id).toBe('exec-error-unknown');
      expect(killCalled).toBe(true);
    }
  });

  it('should handle unknown exec errors gracefully', async () => {
    moxxy.exec.mock(__createErrorMock('Exec failed completely'));

    const result = await processModule.execWithResult('command', {
      throwOnError: false,
    });

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(null);
    expect(result.stderr).toContain('Exec failed completely');
  });

  it('should throw unknown exec errors when throwOnError is true', async () => {
    moxxy.exec.mock(() => {
      throw new Error('Exec failed completely');
    });

    try {
      await processModule.execWithResult('command', { throwOnError: true });
      expect(true).toBe(false);
    } catch (error: any) {
      expect(error.type).toBe('Unknown');
      expect(error.id).toBe('exec-error-unknown');
    }
  });
});

describe('cross-platform argument handling', () => {
  it('should handle commands without $@ placeholder', async () => {
    moxxy.exec.mock(__createExecMock({}));

    await processModule.execWithResult('simple-command', {
      args: ['arg1', 'arg2'],
      throwOnError: false,
    });

    // Should work without errors (command constructed as "simple-command arg1 arg2")
  });

  it('should handle arguments with spaces and quotes', async () => {
    let capturedCommand = '';

    moxxy.exec.mock(
      __createExecMock({
        captureCommand: (cmd) => {
          capturedCommand = cmd;
        },
      })
    );

    await processModule.execWithResult('echo $@', {
      args: ['hello world', 'arg with "quotes"', "arg with 'single quotes'"],
      throwOnError: false,
    });

    expect(capturedCommand).toBe(
      'echo "hello world" "arg with \\"quotes\\"" "arg with \'single quotes\'"'
    );
  });

  it('should handle empty args array', async () => {
    let capturedCommand = '';

    moxxy.exec.mock(
      __createExecMock({
        captureCommand: (cmd) => {
          capturedCommand = cmd;
        },
      })
    );

    await processModule.execWithResult('echo $@', {
      args: [],
      throwOnError: false,
    });

    expect(capturedCommand).toBe('echo ');
  });
});

describe('stream output modes', () => {
  it('should pipe stdout and stderr when streamOutput is enabled', async () => {
    let stdoutPipeCalled = false;
    let stderrPipeCalled = false;

    moxxy.exec.mock(
      __createStreamingMock({
        captureStreamingCalls: (stdout, stderr) => {
          if (stdout) stdoutPipeCalled = true;
          if (stderr) stderrPipeCalled = true;
        },
      })
    );

    await processModule.execWithResult('echo test', {
      streamOutput: true,
      preserveColors: false,
      throwOnError: false,
    });

    expect(stdoutPipeCalled).toBe(true);
    expect(stderrPipeCalled).toBe(true);
  });
});

describe('_exec backward compatibility', () => {
  it('should return stdout on success', async () => {
    moxxy.exec.mock(
      __createExecMock({
        stdout: 'success output',
      })
    );

    const result = await processModule.exec('echo test');
    expect(result).toBe('success output');
  });

  it('should throw error on failure when throwOnError is true', async () => {
    moxxy.exec.mock(
      __createExecMock({
        exitCode: 1,
      })
    );

    try {
      await processModule.exec('failing-command', { throwOnError: true });
      expect(true).toBe(false);
    } catch (error: any) {
      expect(error.type).toBe('Unknown');
      expect(error.id).toBe('process-error-code');
    }
  });

  it('should return stdout even on failure when throwOnError is false', async () => {
    moxxy.exec.mock(
      __createExecMock({
        stdout: 'output before failure',
        exitCode: 1,
      })
    );

    const result = await processModule.exec('failing-command', { throwOnError: false });
    expect(result).toBe('output before failure');
  });
});
