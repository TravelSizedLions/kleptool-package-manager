import { ChildProcess, exec, spawn } from 'node:child_process';
import kerror from './kerror.ts';
import Stream from 'node:stream';

type StreamType = 'inherit' | 'pipe' | 'ignore';

type ProcessOptions = {
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
}

export type ExecOptions = ProcessOptions & {
  stdout?: StreamType;
  stderr?: StreamType;
  shell?: boolean;
  streamOutput?: boolean;
}

export type IpcOptions = ProcessOptions & {
  data?: string;
}

const defaultExecOptions: ExecOptions = {
  args: [],
  cwd: process.cwd(),
  env: process.env as Record<string, string>,
  stdout: 'pipe',
  stderr: 'pipe',
  shell: true,
  streamOutput: false,
}

const defaultIpcOptions: IpcOptions = {
  args: [],
  cwd: process.cwd(),
  env: process.env as Record<string, string>,
}

function execError(command: string, code: number | null, stdout?: string, stderr?: string, streamOutput = false) {
  return kerror(kerror.Unknown, 'exec-error-code', {
    message: `Command "${command}" failed with code ${code}`,
    context: {
      command,
      code,
      stdout: streamOutput ? '[streamed to console]' : stdout,
      stderr: streamOutput ? '[streamed to console]' : stderr,
    },
  });
}

function timeoutError(command: string, timeout: number) {
  return kerror(kerror.Unknown, 'exec-error-timeout', {
    message: `Command "${command}" timed out after ${timeout}ms`,
    context: { command, timeout },
  });
}

function processError(command: string, error: Error) {
  return kerror(kerror.Unknown, 'exec-error-process', {
    message: `Command "${command}" failed`,
    context: {
      command,
      error: error.message,
    },
  });
}

function gatherOutput(stream: Stream.Readable): Promise<string> {
  return new Promise<string>((resolve) => {
    let outputData = '';
    stream.on('data', (chunk) => outputData += chunk.toString());
    stream.on('end', () => resolve(outputData));
  });
}

function setupTimeout(childProcess: ChildProcess, command: string, timeout: number): NodeJS.Timeout {
  return setTimeout(() => {
    childProcess.kill();
  }, timeout);
}

function handleProcessCompletion(
  childProcess: ChildProcess, 
  command: string, 
  timeout?: number
): Promise<{ code: number | null }> {
  return new Promise((resolve, reject) => {
    let timeoutHandle: NodeJS.Timeout | null = null;

    // Setup timeout if specified
    if (timeout && timeout > 0) {
      timeoutHandle = setupTimeout(childProcess, command, timeout);
    }

    childProcess.on('close', (code) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      resolve({ code });
    });

    childProcess.on('error', (error) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      reject(processError(command, error));
    });

    // Handle timeout rejection
    if (timeoutHandle) {
      const originalTimeout = timeoutHandle;
      timeoutHandle = setTimeout(() => {
        clearTimeout(originalTimeout);
        reject(timeoutError(command, timeout!));
      }, timeout!);
    }
  });
}

function sendData(childProcess: ChildProcess, data?: string): void {
  if (data !== undefined) {
    childProcess.stdin?.write(data);
  }
  childProcess.stdin?.end();
}

// IPC communication using stdin and fd3
export async function ipc(cmd: string, options: IpcOptions = {}): Promise<string> {
  const { args, cwd, env, timeout, data } = { ...defaultIpcOptions, ...options };
  const command = `${cmd} ${args?.join(' ') || ''}`.trim();
  
  const childProcess = spawn(cmd, args || [], {
    cwd,
    env,
    stdio: ['pipe', 'inherit', 'inherit', 'pipe'], // stdin, stdout, stderr, fd3
  });

  // Send stdin data
  sendData(childProcess, data);

  // Gather output from fd3 and wait for process completion
  const [output, { code }] = await Promise.all([
    gatherOutput(childProcess.stdio[3] as Stream.Readable),
    handleProcessCompletion(childProcess, command, timeout)
  ]);

  if (code !== 0) {
    throw execError(command, code);
  }

  return output;
}

// Regular shell command execution
export async function _exec(cmd: string, options: ExecOptions = {}): Promise<string> {
  const { args, cwd, env, timeout, streamOutput } = { ...defaultExecOptions, ...options };

  const command = `${cmd} ${args?.join(' ') || ''}`.trim();

  const childProcess = exec(command, { cwd, env, timeout });

  // Handle streaming if requested
  if (streamOutput) {
    childProcess.stdout?.pipe(process.stdout);
    childProcess.stderr?.pipe(process.stderr);
  }

  // Gather output and wait for process completion
  const [stdout, stderr, { code }] = await Promise.all([
    gatherOutput(childProcess.stdout as Stream.Readable),
    gatherOutput(childProcess.stderr as Stream.Readable),
    handleProcessCompletion(childProcess, command, timeout)
  ]);

  if (code !== 0) {
    throw execError(command, code, stdout, stderr, streamOutput);
  }

  return stdout;
}

export default {
  exec: _exec,
  ipc,
}
