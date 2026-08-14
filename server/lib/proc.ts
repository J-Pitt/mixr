import { spawn, type SpawnOptions } from 'node:child_process';

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export class ProcessError extends Error {
  constructor(
    message: string,
    readonly code: number,
    readonly stderr: string,
  ) {
    super(message);
    this.name = 'ProcessError';
  }
}

export interface RunOptions extends SpawnOptions {
  /** Kill the process after this many milliseconds. */
  timeoutMs?: number;
  /** Called with each chunk of stderr, for progress parsing. */
  onStderr?: (chunk: string) => void;
  /** Called with each chunk of stdout. */
  onStdout?: (chunk: string) => void;
  /** Receives the abort handle so callers can cancel long renders. */
  signal?: AbortSignal;
}

/**
 * Promise wrapper around spawn that captures output and always rejects with the
 * tail of stderr, which is the only part of an ffmpeg failure worth reading.
 */
export function run(command: string, args: string[], options: RunOptions = {}): Promise<RunResult> {
  const { timeoutMs, onStderr, onStdout, signal, ...spawnOptions } = options;

  return new Promise<RunResult>((resolve, reject) => {
    const child = spawn(command, args, { ...spawnOptions, stdio: ['ignore', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timer: NodeJS.Timeout | undefined;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };

    const onAbort = () => {
      child.kill('SIGKILL');
    };

    if (signal) {
      if (signal.aborted) {
        child.kill('SIGKILL');
      } else {
        signal.addEventListener('abort', onAbort, { once: true });
      }
    }

    if (timeoutMs) {
      timer = setTimeout(() => {
        child.kill('SIGKILL');
        if (!settled) {
          settled = true;
          cleanup();
          reject(new ProcessError(`${command} timed out after ${timeoutMs}ms`, -1, stderr.slice(-4000)));
        }
      }, timeoutMs);
    }

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
      // Keep memory bounded: yt-dlp -J on a playlist can be enormous.
      if (stdout.length > 64_000_000) stdout = stdout.slice(-32_000_000);
      onStdout?.(chunk);
    });

    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
      if (stderr.length > 2_000_000) stderr = stderr.slice(-1_000_000);
      onStderr?.(chunk);
    });

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new ProcessError(`Could not start ${command}: ${error.message}`, -1, stderr.slice(-4000)));
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (code === 0) {
        resolve({ code: 0, stdout, stderr });
        return;
      }
      if (signal?.aborted) {
        reject(new ProcessError(`${command} was cancelled`, code ?? -1, stderr.slice(-4000)));
        return;
      }
      reject(new ProcessError(`${command} exited with code ${code}`, code ?? -1, stderr.slice(-4000)));
    });
  });
}
