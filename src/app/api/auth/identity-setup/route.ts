import { NextRequest } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import { getAuthUser, unauthorized, success, error } from "@/lib/api-utils";
import { prisma } from "@/lib/db";
import { switchToIdentity, buildCliEnv, saveCurrentTokenToIdentity } from "@/lib/cli/credentials";
import { clearIdentityCache } from "@/lib/identity-cache";

const execFileAsync = promisify(execFile);

function resolveCliPath(): string {
  const base = process.env.CLI_PATH || "tencent-channel-cli";
  if (path.isAbsolute(base)) {
    if (fs.existsSync(base)) return base;
    if (process.platform === "win32" && fs.existsSync(base + ".cmd")) return base + ".cmd";
    return base;
  }
  const localBin = path.join(process.cwd(), "node_modules", ".bin", base);
  if (fs.existsSync(localBin)) return localBin;
  if (process.platform === "win32" && fs.existsSync(localBin + ".cmd")) return localBin + ".cmd";
  return base;
}

async function runCliJson(args: string[], timeoutMs = 15000): Promise<any> {
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
    if (
      process.platform === "win32" &&
      err instanceof Error &&
      (err.message.includes("ENOENT") || (err as NodeJS.ErrnoException).code === "ENOENT") &&
      !cliPath.endsWith(".cmd")
    ) {
      return await tryRun(cliPath + ".cmd");
    }
    throw err;
  }
}

/**
 * POST /api/auth/identity-setup — Start CLI login for current user's identity.
 * No admin restriction — any authenticated user can set up their identity.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return unauthorized();

    const result = await runCliJson(["login", "--json", "--yes"], 15000);
    if (!result?.success) {
      return error(result?.error?.message || "CLI 登录启动失败", 400);
    }
    const data = result.data || {};
    return success({
      authUrl: data.verification_uri || data.authUrl || data.auth_url || null,
      qrcodeBase64: data.qr_code || data.qrcodeBase64 || data.qrcode_base64 || null,
      message: data.message || null,
    });
  } catch (err) {
    console.error("Identity setup start error:", err);
    return error(err instanceof Error ? err.message : "登录启动失败", 500);
  }
}

/**
 * GET /api/auth/identity-setup — Poll for login completion and save to user's identity.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return unauthorized();

    // Find the user's admin identity
    const identity = await prisma.adminIdentity.findFirst({
      where: { nickname: auth.username },
      select: { id: true },
    });
    if (!identity) {
      return error("未找到管理身份，请联系管理员", 404);
    }

    // Switch to this identity's credential dir, then poll
    switchToIdentity(identity.id);
    // Wait for token (poll-token blocks up to 10 min)
    const pollEnv = buildCliEnv();
    const cliPath = resolveCliPath();
    const { stdout } = await execFileAsync(cliPath, ["login", "poll-token", "--json"], {
      timeout: 600000,
      env: pollEnv,
      maxBuffer: 10 * 1024 * 1024,
    });
    const result = JSON.parse(stdout.trim());

    if (!result?.success) {
      return error(result?.error?.message || "扫码授权未完成", 400);
    }

    // Save token to identity (handles encryption, correct key name, etc.)
    await saveCurrentTokenToIdentity(identity.id);

    // Clear cached identity check so session re-validates immediately
    clearIdentityCache(auth.username);

    return success({ message: "身份设置成功" });
  } catch (err: unknown) {
    const execErr = err as { code?: number; message?: string };
    if (execErr?.message?.includes("timed out") || execErr?.code === -1) {
      return error("扫码超时，请重新发起登录", 408);
    }
    console.error("Identity setup poll error:", err);
    return error(err instanceof Error ? err.message : "轮询登录状态失败", 500);
  }
}
