import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

/**
 * Resolves the CLI executable path.
 */
function resolveCliPath(): string {
  const base = process.env.CLI_PATH || "tencent-channel-cli";

  if (path.isAbsolute(base)) {
    if (fs.existsSync(base)) return base;
    if (process.platform === "win32" && fs.existsSync(base + ".cmd")) {
      return base + ".cmd";
    }
    return base;
  }

  const localBin = path.join(process.cwd(), "node_modules", ".bin", base);
  if (fs.existsSync(localBin)) return localBin;
  if (process.platform === "win32" && fs.existsSync(localBin + ".cmd")) {
    return localBin + ".cmd";
  }

  return base;
}

/** Delay helper */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const REQUEST_DELAY_MS = Number(process.env.CLI_REQUEST_DELAY_MS) || 500;
let lastCallTime = 0;

export enum CliErrorCode {
  RATE_LIMIT = 153,
  AUTH_FAILURE = 8011,
  DATA_DELETED = 10014,
}

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

function parseOutput(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
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
 * Convert a snake_case key to a --kebab-case CLI flag.
 *   guild_id   → --guild-id
 *   get_type   → --get-type
 *   feed_attach_info → --feed-attach-info
 */
function toFlag(key: string): string {
  return "--" + key.replace(/_/g, "-");
}

/**
 * Convert a params object to CLI argument array.
 *   { guild_id: "123", count: 20 }  →  ["--guild-id", "123", "--count", "20"]
 *
 * Booleans: true → flag only, false → skipped.
 */
function buildFlagArgs(params: Record<string, any>): string[] {
  const args: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === false || value === undefined || value === null) continue;
    const flag = toFlag(key);
    if (value === true) {
      args.push(flag);
    } else {
      args.push(flag, String(value));
    }
  }
  return args;
}

/**
 * Core CLI executor.
 *
 * Executes: `<cli> <domain> <action> [--flags...] --json`
 *
 * All parameters are passed as command-line flags (converted from
 * snake_case keys to --kebab-case flags). This is the most reliable
 * approach — avoids any stdin pipe timing issues across platforms.
 *
 * Error handling:
 *  - Exit code 153 (rate limit): sleep 70s then retry once.
 *  - Exit code 8011 (auth failure): throws immediately.
 *  - Exit code 10014 (deleted data): returns null.
 *  - Other non-zero exits: throws CliError.
 *
 * @param domain    CLI domain, e.g. "feed" or "manage"
 * @param action    CLI action, e.g. "get-guild-feeds"
 * @param params    Parameters object (snake_case keys → --kebab-case flags)
 * @returns Parsed JSON data field from the CLI response
 */
export async function executeCli(
  domain: string,
  action: string,
  params?: object
): Promise<any> {
  const now = Date.now();
  const elapsed = now - lastCallTime;
  if (elapsed < REQUEST_DELAY_MS) {
    await delay(REQUEST_DELAY_MS - elapsed);
  }
  lastCallTime = Date.now();

  const cliBase = resolveCliPath();

  // Build args: domain action [--flags...] --json
  const flagArgs = params ? buildFlagArgs(params as Record<string, any>) : [];
  const args = [domain, action, ...flagArgs, "--json"];

  console.log(`[CLI] ${domain} ${action}: ${args.join(" ")}`);

  const run = (cliPath: string): any => {
    const result = spawnSync(cliPath, args, {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 120_000,
      maxBuffer: 100 * 1024 * 1024,
      env: { ...process.env },
    });

    const stdout = result.stdout?.toString("utf-8") || "";
    const stderr = result.stderr?.toString("utf-8") || "";

    if (result.error) {
      const err = result.error as NodeJS.ErrnoException;
      throw Object.assign(new Error(err.message), {
        code: err.code === "ENOENT" ? "ENOENT" : -1,
        stderr: stderr || err.message,
        stdout,
      });
    }

    const exitCode = result.status ?? -1;

    if (exitCode !== 0) {
      throw Object.assign(
        new Error(
          `CLI ${domain} ${action} failed (exit ${exitCode}): ${stdout.trim().slice(0, 300)}`
        ),
        { code: exitCode, stderr, stdout }
      );
    }

    const parsed = parseOutput(stdout);
    if (parsed && typeof parsed === "object" && "success" in parsed) {
      if ((parsed as any).success) {
        return (parsed as any).data ?? parsed;
      }
      const errInfo = (parsed as any).error || {};
      const code = errInfo.code ?? -1;
      const hint = errInfo.hint || errInfo.message || "Unknown error";
      throw Object.assign(new Error(hint), {
        code,
        stderr: JSON.stringify(errInfo),
      });
    }
    return parsed;
  };

  const runWithFallback = (): any => {
    try {
      return run(cliBase);
    } catch (err: unknown) {
      if (
        process.platform === "win32" &&
        err instanceof Error &&
        ((err as any).code === "ENOENT" || err.message.includes("ENOENT")) &&
        !cliBase.endsWith(".cmd")
      ) {
        return run(cliBase + ".cmd");
      }
      throw err;
    }
  };

  try {
    return runWithFallback();
  } catch (err: unknown) {
    const execErr = err as { code?: number | string; stderr?: string; message?: string };
    const rawCode = execErr?.code;
    const exitCode = typeof rawCode === "number" ? rawCode : -1;
    const stderr = execErr?.stderr || execErr?.message || "";

    if (exitCode === CliErrorCode.RATE_LIMIT) {
      console.warn(`[CLI] Rate limited (153) on ${domain} ${action}. Sleeping 70s...`);
      await delay(70_000);
      lastCallTime = Date.now();
      try {
        return runWithFallback();
      } catch (retryErr: unknown) {
        const re = retryErr as { code?: number; stderr?: string; message?: string };
        throw new CliError(
          `CLI ${domain} ${action} failed after retry (exit ${typeof re?.code === "number" ? re.code : -1})`,
          typeof re?.code === "number" ? re.code : -1,
          re?.stderr || re?.message || ""
        );
      }
    }

    if (exitCode === CliErrorCode.AUTH_FAILURE) {
      throw new CliError(
        `CLI auth failure on ${domain} ${action}: token may be expired`,
        exitCode, stderr
      );
    }

    if (exitCode === CliErrorCode.DATA_DELETED) {
      console.warn(`[CLI] Data deleted (10014) for ${domain} ${action}.`);
      return null;
    }

    throw new CliError(
      `CLI ${domain} ${action} failed (exit ${exitCode})`,
      exitCode, stderr
    );
  }
}
