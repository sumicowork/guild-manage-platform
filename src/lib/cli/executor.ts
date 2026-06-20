import { execFile } from "child_process";
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
      const child = execFile(
        cliPath,
        args,
        {
          maxBuffer: 100 * 1024 * 1024, // 100 MB — feed dumps can be large
          timeout: 120_000, // 2 min timeout per call
          env: { ...process.env },
        },
        (err, stdout, stderr) => {
          if (err) {
            // Attach stderr to the error for debugging
            const execErr = Object.assign(new Error(err.message), {
              code: (err as any).code ?? -1,
              stderr: stderr || "",
            });
            reject(execErr);
            return;
          }
          try {
            const parsed = parseOutput(stdout);
            // CLI returns { data: {...}, success: true }
            if (parsed && typeof parsed === "object" && "success" in parsed) {
              if ((parsed as any).success) {
                resolve((parsed as any).data ?? parsed);
              } else {
                // CLI returned success: false — extract error info
                const errInfo = (parsed as any).error || {};
                const code = errInfo.code ?? -1;
                const hint = errInfo.hint || errInfo.message || "Unknown error";
                const fakeErr = Object.assign(new Error(hint), {
                  code,
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
        }
      );

      // Pipe stdin JSON if provided
      if (stdinJson && child.stdin) {
        child.stdin.write(JSON.stringify(stdinJson));
        child.stdin.end();
      } else if (child.stdin) {
        child.stdin.end();
      }
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
