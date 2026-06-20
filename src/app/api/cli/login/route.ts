import { NextRequest } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { getAuthUser, unauthorized, forbidden, success, error } from "@/lib/api-utils";

const execFileAsync = promisify(execFile);

function resolveCliPath(): string {
  const base = process.env.CLI_PATH || "tencent-channel-cli";
  if (process.platform === "win32" && !base.endsWith(".cmd") && !base.endsWith(".exe")) {
    return base;
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
 * Response: { success: true, data: { message } } or error on failure/timeout.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return unauthorized();
    if (auth.role !== "admin") return forbidden();

    // poll-token blocks for up to 10 minutes waiting for scan
    const result = await runCliJson(["login", "poll-token", "--json"], 600000);

    if (!result?.success) {
      return error(
        result?.error?.message || "扫码授权未完成",
        400
      );
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
