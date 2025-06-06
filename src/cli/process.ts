import { ChildProcess, exec, spawn } from 'node:child_process';
import kerror from './kerror.ts';
import Stream from 'node:stream';

type StreamType = 'inherit' | 'pipe' | 'ignore';

type ProcessOptions = {
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
};

export type ExecResult = {
  stdout: string;
  stderr: string;
  success: boolean;
  exitCode: number | null;
};

export type ExecOptions = ProcessOptions & {
  stdout?: StreamType;
  stderr?: StreamType;
  shell?: boolean;
  streamOutput?: boolean;
  throwOnError?: boolean;
  preserveColors?: boolean;
};

export type IpcOptions = ProcessOptions & {
  data?: string;
};

const defaultExecOptions: ExecOptions = {
  args: [],
  cwd: process.cwd(),
  env: process.env as Record<string, string>,
  stdout: 'pipe',
  stderr: 'pipe',
  shell: true,
  streamOutput: false,
  throwOnError: true,
  preserveColors: false,
};

const defaultIpcOptions: IpcOptions = {
  args: [],
  cwd: process.cwd(),
  env: process.env as Record<string, string>,
};

function __execError(
  command: string,
  code: number | null,
  stdout?: string,
  stderr?: string,
  streamOutput = false
) {
  return kerror(kerror.Unknown, 'process-error-code', {
    message: `Command "${command}" failed with code ${code}`,
    context: {
      command,
      code,
      stdout: streamOutput ? '[streamed to console]' : stdout,
      stderr: streamOutput ? '[streamed to console]' : stderr,
    },
  });
}

function __timeoutError(command: string, timeout: number) {
  return kerror(kerror.Unknown, 'process-error-timeout', {
    message: `Command "${command}" timed out after ${timeout}ms`,
    context: { command, timeout },
  });
}

function __processError(command: string, error: Error) {
  return kerror(kerror.Unknown, 'process-error-unknown', {
    message: `Command "${command}" failed`,
    context: {
      command,
      error: error.message,
    },
  });
}

function __receive(stream: Stream.Readable): Promise<string> {
  return new Promise<string>((resolve) => {
    let outputData = '';
    stream.on('data', (chunk) => (outputData += chunk.toString()));
    stream.on('end', () => resolve(outputData));
  });
}

function __handleProcessCompletion(
  childProcess: ChildProcess,
  command: string,
  timeout?: number
): Promise<{ code: number | null }> {
  return new Promise((resolve, reject) => {
    let killTimeoutHandle: NodeJS.Timeout | null = null;
    let rejectTimeoutHandle: NodeJS.Timeout | null = null;

    // Setup timeout if specified
    if (timeout && timeout > 0) {
      killTimeoutHandle = setTimeout(() => {
        childProcess.kill();
      }, timeout);

      rejectTimeoutHandle = setTimeout(() => {
        reject(__timeoutError(command, timeout));
      }, timeout);
    }

    childProcess.on('close', (code) => {
      if (killTimeoutHandle) clearTimeout(killTimeoutHandle);
      if (rejectTimeoutHandle) clearTimeout(rejectTimeoutHandle);
      resolve({ code });
    });

    childProcess.on('error', (error) => {
      if (killTimeoutHandle) clearTimeout(killTimeoutHandle);
      if (rejectTimeoutHandle) clearTimeout(rejectTimeoutHandle);
      reject(__processError(command, error));
    });
  });
}

function __send(childProcess: ChildProcess, data?: string): void {
  if (data !== undefined) {
    childProcess.stdin?.write(data);
  }
  childProcess.stdin?.end();
}

// IPC communication using stdin and fd3
export async function ipc(cmd: string, options: IpcOptions = {}): Promise<string> {
  try {
    const { args, cwd, env, timeout, data } = { ...defaultIpcOptions, ...options };
    const command = __withCrossPlatformArgs(cmd, args || []);

    const childProcess = spawn(cmd, args || [], {
      cwd,
      env,
      stdio: ['pipe', 'inherit', 'inherit', 'pipe'], // stdin, stdout, stderr, fd3
    });

    __send(childProcess, data);

    const [output, { code }] = await Promise.all([
      __receive(childProcess.stdio[3] as Stream.Readable),
      __handleProcessCompletion(childProcess, command, timeout),
    ]);

    if (code !== 0) {
      throw __execError(command, code);
    }

    return output;
  } catch (e) {
    throw kerror(kerror.Unknown, 'ipc-error-unknown', {
      message: `Command "${cmd}" failed with unknown error`,
      context: {
        command: cmd,
        error: e instanceof Error ? e.stack : `Unknown error ${e}`,
      },
    });
  }
}

function __withCrossPlatformArgs(cmd: string, args: string[]): string {
  if (!cmd.includes('$@')) {
    return `${cmd} ${args.join(' ') || ''}`.trim();
  }

  const escapedArgs = args
    .map((arg) => {
      if (arg.includes(' ') || arg.includes('"') || arg.includes("'")) {
        return `"${arg.replace(/"/g, '\\"')}"`;
      }

      return arg;
    })
    .join(' ');
  return cmd.replace(/\$@/g, escapedArgs);
}

function __prepareColorEnvironment(
  env: Record<string, string>,
  enableColors: boolean
): Record<string, string> {
  // Check both the enableColors parameter AND the environment being passed to subprocess
  if (!enableColors || env.NO_COLOR || env.CI) return env;

  return {
    ...env,
    FORCE_COLOR: '1',
    TERM: env.TERM || 'xterm-256color',
  };
}

// Regular shell command execution with full result
export async function execWithResult(cmd: string, options: ExecOptions = {}): Promise<ExecResult> {
  try {
    const config = { ...defaultExecOptions, ...options };
    const command = __withCrossPlatformArgs(cmd, config.args || []);
    const enhancedEnv = __prepareColorEnvironment(
      config.env || {},
      Boolean(config.preserveColors || config.streamOutput)
    );

    if (config.streamOutput && config.preserveColors) {
      return await __execWithColorStreaming(command, enhancedEnv, config);
    }

    return await __execWithRegularOutput(command, enhancedEnv, config);
  } catch (e) {
    return __handleExecError(cmd, e, options.throwOnError);
  }
}

async function __execWithColorStreaming(
  command: string,
  env: Record<string, string>,
  config: ExecOptions
): Promise<ExecResult> {
  const [cmdName, ...cmdArgs] = command.split(' ');
  const childProcess = spawn(cmdName, cmdArgs, {
    cwd: config.cwd,
    env,
    stdio: 'inherit',
    shell: true,
  });

  const { code } = await __handleProcessCompletion(childProcess, command, config.timeout);

  return {
    stdout: '[streamed to console with colors]',
    stderr: '[streamed to console with colors]',
    success: code === 0,
    exitCode: code,
  };
}

async function __execWithRegularOutput(
  command: string,
  env: Record<string, string>,
  config: ExecOptions
): Promise<ExecResult> {
  const childProcess = exec(command, {
    cwd: config.cwd,
    env,
    timeout: config.timeout,
  });

  if (config.streamOutput) {
    childProcess.stdout?.pipe(process.stdout);
    childProcess.stderr?.pipe(process.stderr);
  }

  const [stdout, stderr, { code }] = await Promise.all([
    __receive(childProcess.stdout as Stream.Readable),
    __receive(childProcess.stderr as Stream.Readable),
    __handleProcessCompletion(childProcess, command, config.timeout),
  ]);

  return {
    stdout,
    stderr,
    success: code === 0,
    exitCode: code,
  };
}

function __handleExecError(cmd: string, error: unknown, throwOnError?: boolean): ExecResult {
  if (throwOnError && error instanceof Error) {
    throw kerror(kerror.Unknown, 'exec-error-unknown', {
      message: `Command "${cmd}" failed with unknown error`,
      context: {
        command: cmd,
        error: error instanceof Error ? error.stack : `Unknown error ${error}`,
      },
    });
  }

  return {
    stdout: '',
    stderr: error instanceof Error ? error.message : String(error),
    success: false,
    exitCode: null,
  };
}

// Regular shell command execution (backward compatibility)
export async function _exec(cmd: string, options: ExecOptions = {}): Promise<string> {
  const result = await execWithResult(cmd, options);

  if (!result.success && options.throwOnError) {
    throw __execError(cmd, result.exitCode, result.stdout, result.stderr, options.streamOutput);
  }

  return result.stdout;
}

export default {
  exec: _exec,
  execWithResult,
  ipc,
};
