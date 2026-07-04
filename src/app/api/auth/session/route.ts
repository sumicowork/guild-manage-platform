import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, success, error, serializeBigInt } from "@/lib/api-utils";
import { switchToIdentity, buildCliEnv } from "@/lib/cli/credentials";
import { getCachedIdentityStatus, setCachedIdentityStatus } from "@/lib/identity-cache";
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";

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

async function checkIdentityLive(identityId: bigint): Promise<string> {
  try {
    await switchToIdentity(identityId);
    const env = buildCliEnv(identityId);
    const cliPath = resolveCliPath();
    const { stdout } = await execFileAsync(cliPath, ["login", "status", "--json"], {
      env: { ...process.env, ...env },
      timeout: 15000,
      maxBuffer: 1024 * 1024,
    });
    const result = JSON.parse(stdout.trim());
    return result?.data?.valid ? "ready" : "expired";
  } catch {
    return "expired";
  }
}

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return unauthorized();

    const user = await prisma.platformUser.findUnique({
      where: { id: BigInt(auth.userId) },
      select: { id: true, username: true, display_name: true, role: true },
    });

    if (!user) return error("用户不存在", 404);

    let identityStatus = "ready";
    if (user.role !== "admin") {
      const identity = await prisma.adminIdentity.findFirst({
        where: { nickname: user.username },
        select: { id: true, token: true },
      });

      if (!identity || !identity.token) {
        identityStatus = "needs_login";
      } else {
        const cached = getCachedIdentityStatus(user.username);
        if (cached !== undefined) {
          identityStatus = cached;
        } else {
          identityStatus = await checkIdentityLive(identity.id);
          setCachedIdentityStatus(user.username, identityStatus);
        }
      }
    }

    return success({
      user: serializeBigInt({
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        role: user.role,
      }),
      identityStatus,
    });
  } catch (err) {
    console.error("Session error:", err);
    return error("获取会话信息失败", 500);
  }
}
