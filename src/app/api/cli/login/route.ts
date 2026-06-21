import { NextRequest } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import { getAuthUser, unauthorized, forbidden, success, error } from "@/lib/api-utils";
import { saveCurrentTokenToIdentity } from "@/lib/cli/credentials";

const execFileAsync = promisify(execFile);

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

async function runCliJson(
  args: string[],
  timeoutMs = 15000
): Promise<any> {
  const cliPath = resolveCliPath();
  const tryRun = async (bin: string) => {
    const { stdout } = await execFileAsync(bin, args, {
      timeout: timeoutMs,
      env: { ...process.env },
      maxBuffer: 10 * 1024 * 1024,
    });
    return JSON.parse(stdout.trim());
  };

  try {
    return await tryRun(cliPath);
  } catch (err: unknown) {
    // Windows .cmd fallback
    if (
      process.platform === "win32" &&
      err instanceof Error &&
      (err.message.includes("ENOENT") ||
        (err as NodeJS.ErrnoException).code === "ENOENT") &&
      !cliPath.endsWith(".cmd")
    ) {
      return await tryRun(cliPath + ".cmd");
    }
    throw err;
  }
}

/**
 * POST /api/cli/login — Start CLI login flow.
 *
 * Runs `tencent-channel-cli login --json --yes` which returns immediately
 * with an authorization URL and QR code base64 data.
 *
 * Response: { success: true, data: { authUrl, qrcodeBase64, qrcodePath } }
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return unauthorized();
    if (auth.role !== "admin") return forbidden();

    const result = await runCliJson(["login", "--json", "--yes"], 15000);

    if (!result?.success) {
      return error(result?.error?.message || "CLI 登录启动失败", 400);
    }

    const data = result.data || {};

    return success({
      authUrl: data.verification_uri || data.authUrl || data.auth_url || null,
      qrcodeBase64: data.qr_code || data.qrcodeBase64 || data.qrcode_base64 || null,
      qrcodePath: data.qrcode_path || data.qrcodePath || null,
      message: data.message || null,
      expiresIn: data.expires_in_s || null,
    });
  } catch (err) {
    console.error("CLI login start error:", err);
    return error(
      err instanceof Error ? err.message : "CLI 登录启动失败",
      500
    );
  }
}

/**
 * GET /api/cli/login — Poll for login completion.
 *
 * Runs `tencent-channel-cli login poll-token --json` which blocks until
 * the user scans the QR code and completes authorization (up to 10 min).
 *
 * Query params:
 *   identityId (optional) — After successful login, save the token to this AdminIdentity.
 *
 * Response: { success: true, data: { message } } or error on failure/timeout.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return unauthorized();
    if (auth.role !== "admin") return forbidden();

    // Check for identityId query param
    const { searchParams } = new URL(req.url);
    const identityId = searchParams.get("identityId");

    // poll-token blocks for up to 10 minutes waiting for scan
    const result = await runCliJson(["login", "poll-token", "--json"], 600000);

    if (!result?.success) {
      return error(
        result?.error?.message || "扫码授权未完成",
        400
      );
    }

    // ── 登录成功后提取 token 并保存 ──
    if (identityId) {
      try {
        await saveCurrentTokenToIdentity(BigInt(identityId));
      } catch (saveErr) {
        console.error("Failed to save token after login:", saveErr);
        // Don't fail the login response — token save is best-effort
      }
    }

    return success({
      message: result.data?.message || "登录成功",
    });
  } catch (err: unknown) {
    const execErr = err as { code?: number; stderr?: string; message?: string };
    // Timeout is expected if user doesn't scan in time
    if (execErr?.message?.includes("timed out") || execErr?.code === -1) {
      return error("扫码超时，请重新发起登录", 408);
    }
    console.error("CLI login poll error:", err);
    return error(
      err instanceof Error ? err.message : "轮询登录状态失败",
      500
    );
  }
}
