import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";

const execFileAsync = promisify(execFile);

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

  // For relative/ bare command names on Windows, try .cmd suffix
  if (process.platform === "win32") {
    // Check if the bare command resolves (i.e. it's on PATH)
    // We try the base first; if execFile fails we'll try .cmd in executeCli
    return base;
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
 * Builds an argument array from domain, action, and a flags record.
 * Automatically appends --json for machine-readable output.
 *
 * Example:
 *   buildArgs("feed", "get-guild-feeds", { "guild-id": "123", count: 20 })
 *   => ["feed", "get-guild-feeds", "--guild-id", "123", "--count", "20", "--json"]
 */
function buildArgs(
  domain: string,
  action: string,
  flags: Record<string, string | number | boolean>
): string[] {
  const args: string[] = [domain, action];

  for (const [key, value] of Object.entries(flags)) {
    if (value === false || value === undefined || value === null) continue;
    const flagName = key.length === 1 ? `-${key}` : `--${key}`;
    if (value === true) {
      args.push(flagName);
    } else {
      args.push(flagName, String(value));
    }
  }

  args.push("--json");
  return args;
}

/**
 * Parses stdout as JSON. Returns null on empty output.
 */
function parseOutput(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    // Some CLIs emit non-JSON success messages; wrap them
    return { raw: trimmed };
  }
}

/**
 * Core CLI executor.
 *
 * Executes: `<cli> <domain> <action> [flags...] [--json]`
 *
 * Error handling:
 *  - Exit code 153 (rate limit): sleeps 70s then retries once.
 *  - Exit code 8011 (auth failure): throws immediately.
 *  - Exit code 10014 (deleted data): returns null.
 *  - Other non-zero exits: throws CliError.
 *
 * @param domain    CLI domain, e.g. "feed" or "member"
 * @param action    CLI action, e.g. "get-guild-feeds"
 * @param flags     Key-value flags to pass as CLI arguments
 * @param stdinJson Optional JSON object piped to the process stdin
 * @returns Parsed JSON output from the CLI
 */
export async function executeCli(
  domain: string,
  action: string,
  flags: Record<string, string | number | boolean> = {},
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
  const args = buildArgs(domain, action, flags);

  const run = async (cliPath: string): Promise<any> => {
    const childPromise = execFileAsync(cliPath, args, {
      maxBuffer: 100 * 1024 * 1024, // 100 MB — feed dumps can be large
      timeout: 120_000, // 2 min timeout per call
      env: { ...process.env },
    });

    // Pipe stdin if provided
    if (stdinJson && childPromise.child) {
      const child = childPromise.child;
      child.stdin?.write(JSON.stringify(stdinJson));
      child.stdin?.end();
    }

    const { stdout, stderr } = await childPromise;
    return parseOutput(stdout);
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

    // Rate limit: sleep 70s and retry once
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
