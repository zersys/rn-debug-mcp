import { spawn } from "node:child_process";

export interface ExecOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  input?: string | Buffer;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface BinaryExecResult {
  stdout: Buffer;
  stderr: Buffer;
  exitCode: number;
}

export interface SpawnOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface SpawnedProcess {
  onStdout(listener: (chunk: string) => void): void;
  onStderr(listener: (chunk: string) => void): void;
  stop(): Promise<void>;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

export interface ProcessRunner {
  exec(command: string, args: string[], options?: ExecOptions): Promise<ExecResult>;
  execBinary(command: string, args: string[], options?: ExecOptions): Promise<BinaryExecResult>;
  spawn(command: string, args: string[], options?: SpawnOptions): SpawnedProcess;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs?: number): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) {
    return promise;
  }

  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`Command timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) {
      clearTimeout(timeout);
    }
  });
}

export class NodeProcessRunner implements ProcessRunner {
  async exec(command: string, args: string[], options: ExecOptions = {}): Promise<ExecResult> {
    const result = await withTimeout(this.execInternal(command, args, options), options.timeoutMs);
    return {
      stdout: result.stdout.toString("utf8"),
      stderr: result.stderr.toString("utf8"),
      exitCode: result.exitCode,
    };
  }

  execBinary(command: string, args: string[], options: ExecOptions = {}): Promise<BinaryExecResult> {
    return withTimeout(this.execInternal(command, args, options), options.timeoutMs);
  }

  spawn(command: string, args: string[], options: SpawnOptions = {}): SpawnedProcess {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");

    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      child.once("close", (code, signal) => {
        resolve({ code, signal });
      });
    });

    return {
      onStdout(listener: (chunk: string) => void): void {
        child.stdout?.on("data", listener);
      },
      onStderr(listener: (chunk: string) => void): void {
        child.stderr?.on("data", listener);
      },
      async stop(): Promise<void> {
        if (child.killed) {
          return;
        }

        child.kill("SIGTERM");
        const result = await Promise.race([
          exited,
          new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
            setTimeout(() => {
              child.kill("SIGKILL");
              resolve({ code: null, signal: "SIGKILL" });
            }, 1500);
          }),
        ]);

        if (result.signal === "SIGKILL") {
          await exited;
        }
      },
      exited,
    };
  }

  private execInternal(command: string, args: string[], options: ExecOptions): Promise<BinaryExecResult> {
    return new Promise<BinaryExecResult>((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env,
        stdio: ["pipe", "pipe", "pipe"],
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      child.stdout?.on("data", (chunk: Buffer | string) => {
        stdoutChunks.push(typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk);
      });

      child.stderr?.on("data", (chunk: Buffer | string) => {
        stderrChunks.push(typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk);
      });

      child.once("error", (error) => reject(error));

      if (options.input !== undefined && child.stdin) {
        child.stdin.write(options.input);
        child.stdin.end();
      } else {
        child.stdin?.end();
      }

      child.once("close", (code) => {
        if (code === null) {
          reject(new Error(`Command ${command} ${args.join(" ")} exited without a code`));
          return;
        }

        resolve({
          stdout: Buffer.concat(stdoutChunks),
          stderr: Buffer.concat(stderrChunks),
          exitCode: code,
        });
      });
    });
  }
}
