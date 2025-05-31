import { exec } from 'node:child_process';
import kerror from './kerror.ts';

type StreamType = 'inherit' | 'pipe' | 'ignore';

export type ExecOptions = {
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  stdout?: StreamType;
  stderr?: StreamType;
  shell?: boolean;
  timeout?: number;
  streamOutput?: boolean;
}

const defaultOptions: ExecOptions = {
  args: [],
  cwd: process.cwd(),
  env: process.env as Record<string, string>,
  stdout: 'pipe',
  stderr: 'pipe',
  shell: true,
  streamOutput: false,
}

export default (cmd: string, options: ExecOptions = {}): Promise<string> => {
  return new Promise((resolve, reject) => {  
    const { args, cwd, env, timeout, streamOutput } = { ...defaultOptions, ...options };
    
    // Build the full command with arguments
    const fullCommand = args && args.length > 0 
      ? `${cmd} ${args.join(' ')}` 
      : cmd;
    
    // Use exec which is more reliable for shell commands
    const childProcess = exec(fullCommand, {
      cwd,
      env,
      timeout,
    });

    let stdout = '';
    let stderr = '';
    
    // Handle streaming or collecting output
    
    if (childProcess.stdout && childProcess.stderr) {
      // Collect output
      childProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      childProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      if (streamOutput) {
        childProcess.stdout.pipe(process.stdout);
        childProcess.stderr.pipe(process.stderr);
      }
    }

    childProcess.on('close', (code) => {
      if (code !== 0) {
        reject(
          kerror(kerror.Unknown, 'exec-error', {
            message: `Command "${fullCommand}" failed with code ${code}`,
            context: {
              command: fullCommand,
              code,
              stdout: streamOutput ? '[streamed to console]' : stdout,
              stderr: streamOutput ? '[streamed to console]' : stderr,
            },
          })
        );
        return;
      }
      
      resolve(stdout);
    });

    childProcess.on('error', (error) => {
      reject(
        kerror(kerror.Unknown, 'exec-error', {
          message: `Command "${fullCommand}" failed`,
          context: {
            command: fullCommand,
            error: error.message,
            stdout: streamOutput ? '[streamed to console]' : stdout,
            stderr: streamOutput ? '[streamed to console]' : stderr,
          },
        })
      );
    });
  });
}
