import { NextRequest } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { getAuthUser, unauthorized, forbidden, success, error } from "@/lib/api-utils";

const execFileAsync = promisify(execFile);

/**
 * Resolve the CLI binary path (mirrors executor.ts logic).
 */
function resolveCliPath(): string {
  const base = process.env.CLI_PATH || "tencent-channel-cli";
  if (process.platform === "win32" && !base.endsWith(".cmd") && !base.endsWith(".exe")) {
    // On Windows the bare command may need .cmd — we let execFile handle it
    return base;
  }
  return base;
}

/**
 * Run a CLI sub-command and return parsed JSON stdout.
 * Returns null if the command fails.
 */
async function runCliJson(
  args: string[],
  timeoutMs = 15000
): Promise<any | null> {
  const cliPath = resolveCliPath();
  try {
    const { stdout } = await execFileAsync(cliPath, args, {
      timeout: timeoutMs,
      env: { ...process.env },
      maxBuffer: 10 * 1024 * 1024,
    });
    return JSON.parse(stdout.trim());
  } catch (err: unknown) {
    // On Windows, retry with .cmd suffix
    if (
      process.platform === "win32" &&
      err instanceof Error &&
      (err.message.includes("ENOENT") ||
        (err as NodeJS.ErrnoException).code === "ENOENT") &&
      !cliPath.endsWith(".cmd")
    ) {
      try {
        const { stdout } = await execFileAsync(cliPath + ".cmd", args, {
          timeout: timeoutMs,
          env: { ...process.env },
          maxBuffer: 10 * 1024 * 1024,
        });
        return JSON.parse(stdout.trim());
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * GET /api/cli/status — returns CLI diagnostic info.
 *
 * Response shape:
 * {
 *   success: true,
 *   data: {
 *     checks: [{ name, pass, detail, hint? }],
 *     version: string | null,
 *     loggedIn: boolean,
 *     loginStatus: { valid, tokenSource?, message? } | null,
 *     environment: { cliPath, cliRequestDelayMs, guildId }
 *   }
 * }
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return unauthorized();
    if (auth.role !== "admin") return forbidden();

    // Run doctor and login status in parallel
    const [doctorResult, loginStatusResult] = await Promise.allSettled([
      runCliJson(["doctor", "--json"], 15000),
      runCliJson(["login", "status", "--json"], 10000),
    ]);

    const doctor = doctorResult.status === "fulfilled" ? doctorResult.value : null;
    const loginStatus =
      loginStatusResult.status === "fulfilled" ? loginStatusResult.value : null;

    // Extract checks array from doctor output
    const checks: Array<{
      name: string;
      pass: boolean;
      detail: string;
      hint?: string;
    }> = doctor?.data && Array.isArray(doctor.data)
      ? doctor.data.map((c: any) => ({
          name: c.name || "",
          pass: !!c.pass,
          detail: c.detail || "",
          hint: c.hint || undefined,
        }))
      : [];

    // Extract version from checks (or from a separate version call)
    const versionCheck = checks.find((c) => c.name.includes("版本"));
    const version = versionCheck?.detail?.match(/版本\s*([\d.]+)/)?.[1] || null;

    // Login status
    const loggedIn =
      loginStatus?.data?.valid === true ||
      checks.some(
        (c) => c.name.includes("登录") && c.pass
      );

    return success({
      checks,
      version,
      loggedIn,
      loginStatus: loginStatus?.data || null,
      environment: {
        cliPath: process.env.CLI_PATH || "tencent-channel-cli",
        cliRequestDelayMs: process.env.CLI_REQUEST_DELAY_MS || "500",
        guildId: process.env.GUILD_ID || "",
      },
    });
  } catch (err) {
    console.error("CLI status error:", err);
    return error("获取 CLI 状态失败", 500);
  }
}
