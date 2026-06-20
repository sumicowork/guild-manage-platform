import { spawn } from "child_process";
import fs from "fs";
import path from "path";

/**
 * Resolves the CLI executable path.
 * On Windows, tries CLI_PATH first, then falls back to CLI_PATH + '.cmd'.
 */
function resolveCliPath(): string {
  const base = process.env.CLI_PATH || "tencent-channel-cli";

  // If the path is absolute and exists, return it directly
  if (path.isAbsolute(base)) {
    if (fs.existsSync(base)) return base;
    if (process.platform === "win32" && fs.existsSync(base + ".cmd")) {
      return base + ".cmd";
    }
    return base;
  }

  // Check node_modules/.bin first (local project install)
  const localBin = path.join(process.cwd(), "node_modules", ".bin", base);
  if (fs.existsSync(localBin)) return localBin;
  if (process.platform === "win32" && fs.existsSync(localBin + ".cmd")) {
    return localBin + ".cmd";
  }

  return base;
}

/** Delay helper to throttle CLI requests */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Configurable request delay between consecutive CLI calls (ms) */
const REQUEST_DELAY_MS = Number(process.env.CLI_REQUEST_DELAY_MS) || 500;

/** Tracks the timestamp of the last CLI call for throttling */
let lastCallTime = 0;

/**
 * Error codes emitted by tencent-channel-cli.
 */
export enum CliErrorCode {
  RATE_LIMIT = 153,
  AUTH_FAILURE = 8011,
  DATA_DELETED = 10014,
}

/**
 * Custom error class carrying the CLI exit code and stderr output.
 */
export class CliError extends Error {
  public readonly code: number;
  public readonly stderr: string;

  constructor(message: string, code: number, stderr: string) {
    super(message);
    this.name = "CliError";
    this.code = code;
    this.stderr = stderr;
  }
}

/**
 * Parses stdout as JSON. Returns null on empty output.
 * Handles multi-line output by trying the last valid JSON line.
 */
function parseOutput(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    // Try parsing the last line (some CLIs emit debug lines before JSON)
    const lines = trimmed.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        return JSON.parse(lines[i].trim());
      } catch {
        continue;
      }
    }
    return { raw: trimmed };
  }
}

/**
 * Core CLI executor.
 *
 * Executes: `<cli> <domain> <action> --json`
 *
 * Parameters are passed via stdin as JSON (snake_case keys), matching the
 * original Python guild_scraper.py approach. The CLI tool reads stdin JSON
 * for all action parameters — NOT command-line flags.
 *
 * Error handling:
 *  - Exit code 153 (rate limit): exponential backoff + retry.
 *  - Exit code 8011 (auth failure): throws immediately.
 *  - Exit code 10014 (deleted data): returns null.
 *  - Other non-zero exits: throws CliError.
 *
 * @param domain    CLI domain, e.g. "feed" or "manage"
 * @param action    CLI action, e.g. "get-guild-feeds"
 * @param stdinJson JSON object piped to the process stdin (snake_case keys)
 * @returns Parsed JSON data field from the CLI response
 */
export async function executeCli(
  domain: string,
  action: string,
  stdinJson?: object
): Promise<any> {
  // Throttle: ensure minimum delay between calls
  const now = Date.now();
  const elapsed = now - lastCallTime;
  if (elapsed < REQUEST_DELAY_MS) {
    await delay(REQUEST_DELAY_MS - elapsed);
  }
  lastCallTime = Date.now();

  const cliBase = resolveCliPath();
  const args = [domain, action, "--json"];

  const run = (cliPath: string): Promise<any> => {
    return new Promise((resolve, reject) => {
      const child = spawn(cliPath, args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env },
        // Windows needs shell: true to run .cmd wrappers
        shell: process.platform === "win32",
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let totalStdout = 0;
      const MAX_BUFFER = 100 * 1024 * 1024; // 100 MB

      child.stdout.on("data", (chunk: Buffer) => {
        totalStdout += chunk.length;
        if (totalStdout > MAX_BUFFER) {
          child.kill();
          reject(new Error("CLI stdout exceeded max buffer"));
          return;
        }
        stdoutChunks.push(chunk);
      });

      child.stderr.on("data", (chunk: Buffer) => {
        stderrChunks.push(chunk);
      });

      // Apply timeout
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`CLI ${domain} ${action} timed out after 120s`));
      }, 120_000);

      child.on("error", (err) => {
        clearTimeout(timer);
        reject(Object.assign(err, { code: -1, stderr: err.message }));
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
        const stderr = Buffer.concat(stderrChunks).toString("utf-8");

        if (code !== 0) {
          // Include stdout in error — CLI writes validation errors there
          const errObj = Object.assign(
            new Error(`CLI ${domain} ${action} failed (exit ${code}): ${stdout.trim().slice(0, 300)}`),
            { code: code ?? -1, stderr: stderr || "", stdout: stdout || "" }
          );
          reject(errObj);
          return;
        }

        try {
          const parsed = parseOutput(stdout);
          if (parsed && typeof parsed === "object" && "success" in parsed) {
            if ((parsed as any).success) {
              resolve((parsed as any).data ?? parsed);
            } else {
              const errInfo = (parsed as any).error || {};
              const eCode = errInfo.code ?? -1;
              const hint = errInfo.hint || errInfo.message || "Unknown error";
              const fakeErr = Object.assign(new Error(hint), {
                code: eCode,
                stderr: JSON.stringify(errInfo),
              });
              reject(fakeErr);
            }
          } else {
            resolve(parsed);
          }
        } catch (parseErr) {
          reject(parseErr);
        }
      });

      // Pipe stdin JSON — spawn guarantees stdin is a writable pipe
      if (stdinJson) {
        const jsonStr = JSON.stringify(stdinJson);
        console.log(`[CLI] ${domain} ${action} stdin: ${jsonStr.slice(0, 200)}`);
        child.stdin.write(jsonStr);
      }
      child.stdin.end();
    });
  };

  const runWithFallback = async (): Promise<any> => {
    try {
      return await run(cliBase);
    } catch (err: unknown) {
      // On Windows, retry with .cmd suffix if the bare command was not found
      if (
        process.platform === "win32" &&
        err instanceof Error &&
        (err.message.includes("ENOENT") ||
          (err as NodeJS.ErrnoException).code === "ENOENT") &&
        !cliBase.endsWith(".cmd")
      ) {
        return run(cliBase + ".cmd");
      }
      throw err;
    }
  };

  try {
    return await runWithFallback();
  } catch (err: unknown) {
    // Extract exit code from the error
    const execErr = err as { code?: number; stderr?: string; message?: string };
    const exitCode = typeof execErr?.code === "number" ? execErr.code : -1;
    const stderr = execErr?.stderr || execErr?.message || "";

    // Rate limit: exponential backoff and retry
    if (exitCode === CliErrorCode.RATE_LIMIT) {
      console.warn(
        `[CLI] Rate limited (code 153) on ${domain} ${action}. Sleeping 70s before retry...`
      );
      await delay(70_000);
      lastCallTime = Date.now();
      try {
        return await runWithFallback();
      } catch (retryErr: unknown) {
        const retryExecErr = retryErr as {
          code?: number;
          stderr?: string;
          message?: string;
        };
        const retryCode =
          typeof retryExecErr?.code === "number" ? retryExecErr.code : -1;
        const retryStderr =
          retryExecErr?.stderr || retryExecErr?.message || "";
        throw new CliError(
          `CLI ${domain} ${action} failed after retry (exit ${retryCode})`,
          retryCode,
          retryStderr
        );
      }
    }

    // Auth failure: throw immediately without retry
    if (exitCode === CliErrorCode.AUTH_FAILURE) {
      throw new CliError(
        `CLI auth failure on ${domain} ${action}: token may be expired`,
        exitCode,
        stderr
      );
    }

    // Deleted data: return null gracefully
    if (exitCode === CliErrorCode.DATA_DELETED) {
      console.warn(
        `[CLI] Data deleted (code 10014) for ${domain} ${action}. Returning null.`
      );
      return null;
    }

    // Generic error
    throw new CliError(
      `CLI ${domain} ${action} failed (exit ${exitCode})`,
      exitCode,
      stderr
    );
  }
}
