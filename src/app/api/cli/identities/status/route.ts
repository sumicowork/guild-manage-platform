import { NextRequest } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import { getAuthUser, unauthorized, forbidden, success, error } from "@/lib/api-utils";
import { prisma } from "@/lib/db";
import { switchToIdentity, buildCliEnv } from "@/lib/cli/credentials";
import { invalidateIdentityPool } from "@/lib/cli/executor";

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

  const localBin = path.join(process.cwd(), "node_modules", ".bin", base);
  if (fs.existsSync(localBin)) return localBin;
  if (process.platform === "win32" && fs.existsSync(localBin + ".cmd")) {
    return localBin + ".cmd";
  }

  return base;
}

async function checkStatus(identityId: bigint): Promise<{
  valid: boolean;
  tokenSource: string | null;
  error?: string;
  log: string[];
}> {
  const logs: string[] = [];
  try {
    logs.push(`switchToIdentity(${identityId})...`);
    await switchToIdentity(identityId);
    logs.push(`switchToIdentity done`);

    const env = buildCliEnv(identityId);
    const dotenvValue = env.QQ_AI_CONNECT_DOTENV || '(not set)';
    logs.push(`QQ_AI_CONNECT_DOTENV=${dotenvValue}`);

    const cliPath = resolveCliPath();
    logs.push(`CLI: ${cliPath} login status --json`);

    const tryRun = async (bin: string) => {
      const { stdout, stderr } = await execFileAsync(bin, ["login", "status", "--json"], {
        env: { ...process.env, ...env },
        timeout: 15000,
        maxBuffer: 1024 * 1024,
      });
      return { stdout, stderr };
    };

    let result: { stdout: string; stderr?: string };
    try {
      result = await tryRun(cliPath);
    } catch (err: unknown) {
      // Windows .cmd fallback
      if (
        process.platform === "win32" &&
        err instanceof Error &&
        (err.message.includes("ENOENT") ||
          (err as NodeJS.ErrnoException).code === "ENOENT") &&
        !cliPath.endsWith(".cmd")
      ) {
        logs.push(`fallback to ${cliPath}.cmd`);
        result = await tryRun(cliPath + ".cmd");
      } else {
        throw err;
      }
    }

    const parsed = JSON.parse(result.stdout.trim());
    logs.push(`CLI raw: ${result.stdout.trim().substring(0, 200)}`);

    if (parsed?.success && parsed?.data) {
      const valid = parsed.data.valid === true;
      const tokenSource = parsed.data.tokenSource || null;
      logs.push(`result: valid=${valid} tokenSource=${tokenSource}`);
      return { valid, tokenSource, log: logs };
    }

    logs.push(`result: CLI success=false`);
    return { valid: false, tokenSource: null, log: logs };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message.slice(0, 200) : "检查失败";
    logs.push(`ERROR: ${errMsg}`);
    return { valid: false, tokenSource: null, error: errMsg, log: logs };
  }
}

/**
 * GET /api/cli/identities/status
 *
 * 逐一验证每个管理身份的登录状态。
 * 对已有 token 的身份调用 `login status --json` 确认有效性。
 *
 * Returns:
 *   {
 *     identities: [{
 *       id, name,
 *       status: "valid" | "expired" | "no_token" | "error",
 *       tokenSource: string | null,
 *       error?: string
 *     }],
 *     summary: { valid, expired, noToken, error }
 *   }
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return unauthorized();
    if (auth.role !== "admin") return forbidden();

    const identities = await prisma.adminIdentity.findMany({
      orderBy: { id: "asc" },
    });

    // 逐个验证（不并行，避免触发 CLI 限流）
    const results: Array<{
      id: number;
      name: string;
      status: "valid" | "expired" | "no_token" | "error";
      tokenSource: string | null;
      error?: string;
      log?: string[];
    }> = [];
    const allLogs: string[] = [];

    for (const identity of identities) {
      const base = {
        id: Number(identity.id),
        name: identity.nickname,
        tokenSource: null as string | null,
      };

      if (!identity.token) {
        const entry = { ...base, status: "no_token" as const, log: [`${identity.nickname}: no token in DB`] };
        results.push(entry);
        allLogs.push(`[${identity.nickname}] SKIP: no token stored`);
        continue;
      }

      const status = await checkStatus(identity.id);
      allLogs.push(`[${identity.nickname}] ${"=".repeat(20)}`);
      allLogs.push(...status.log.map(l => `  ${l}`));

      if (status.error) {
        results.push({ ...base, status: "error" as const, error: status.error, log: status.log });
      } else if (status.valid) {
        results.push({ ...base, status: "valid" as const, tokenSource: status.tokenSource, log: status.log });
        // Sync DB status on admin manual check
        prisma.adminIdentity.update({
          where: { id: identity.id },
          data: { status: "active" },
        }).catch(() => {});
      } else {
        results.push({ ...base, status: "expired" as const, log: status.log });
        prisma.adminIdentity.update({
          where: { id: identity.id },
          data: { status: "expired" },
        }).catch(() => {});
      }
    }

    const summary = {
      valid: results.filter((r) => r.status === "valid").length,
      expired: results.filter((r) => r.status === "expired").length,
      noToken: results.filter((r) => r.status === "no_token").length,
      error: results.filter((r) => r.status === "error").length,
    };

    return success({ identities: results, summary, logs: allLogs });
  } catch (err) {
    console.error("Identity status check error:", err);
    return error("获取身份状态失败", 500);
  } finally {
    // Refresh identity pool with latest DB status
    invalidateIdentityPool();
  }
}
