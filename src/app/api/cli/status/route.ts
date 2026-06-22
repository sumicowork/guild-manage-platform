import { NextRequest } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import { getAuthUser, unauthorized, forbidden, success, error } from "@/lib/api-utils";
import { prisma } from "@/lib/db";
import { switchToIdentity, buildCliEnv } from "@/lib/cli/credentials";

const execFileAsync = promisify(execFile);

/**
 * Resolve the CLI binary path (mirrors executor.ts logic).
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

  // Check node_modules/.bin first (local project install)
  const localBin = path.join(process.cwd(), "node_modules", ".bin", base);
  if (fs.existsSync(localBin)) return localBin;
  if (process.platform === "win32" && fs.existsSync(localBin + ".cmd")) {
    return localBin + ".cmd";
  }

  return base;
}

/**
 * Run a CLI sub-command and return parsed JSON stdout.
 * Returns null if the command fails.
 */
async function runCliJson(
  args: string[],
  timeoutMs = 15000,
  envOverride?: NodeJS.ProcessEnv
): Promise<any | null> {
  const cliPath = resolveCliPath();
  const env = envOverride || { ...process.env };
  try {
    const { stdout } = await execFileAsync(cliPath, args, {
      timeout: timeoutMs,
      env,
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
          env,
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

    // 从 DB 自动选取第一个有 token 的管理员身份
    let identityName: string | null = null;
    const anyIdentity = await prisma.adminIdentity.findFirst({
      where: { token: { not: "" } },
      select: { id: true, nickname: true },
      orderBy: { id: "asc" },
    });

    if (anyIdentity) {
      await switchToIdentity(anyIdentity.id);
      identityName = anyIdentity.nickname;
    } else {
      console.warn("[CLI status] No admin identity with token found in DB");
    }

    const cliEnv = anyIdentity ? buildCliEnv(anyIdentity.id) : { ...process.env };

    // Run doctor and login status in parallel
    const [doctorResult, loginStatusResult] = await Promise.allSettled([
      runCliJson(["doctor", "--json"], 15000, cliEnv),
      runCliJson(["login", "status", "--json"], 10000, cliEnv),
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
      identityName,
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
