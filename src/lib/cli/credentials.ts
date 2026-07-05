/**
 * CLI 凭证管理模块
 *
 * 管理 tencent-channel-cli 的多管理员凭证切换。
 *
 * 架构说明：
 * - 在 Windows 上，CLI 使用系统密钥链（keychain），不受 env 影响
 * - 在 Alpine/Docker 上，密钥链不可用，CLI 回退到 ~/.qqcli/.env 文件
 * - 本模块通过 QQ_AI_CONNECT_DOTENV env var 让 CLI 读取自定义 .env 路径
 *   或直接写入 ~/.qqcli/.env 文件（同步写+执行，避免竞态）
 *
 * 凭证目录结构（由 CLI_CREDENTIALS_DIR 控制，默认 .qqcli/credentials/）：
 *   credentials/{identityId}/credentials.env
 *   在 CLI 调用时通过 QQ_AI_CONNECT_DOTENV 指向此文件
 */
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import fs from "fs";
import path from "path";
import os from "os";

/** 凭证目录基础路径 */
function getCredentialBaseDir(): string {
  return process.env.CLI_CREDENTIALS_DIR || path.join(os.homedir(), ".qqcli");
}

/** 获取指定身份对应的 .env 文件路径 */
function getCredentialEnvPath(identityId: bigint | number): string {
  const base = getCredentialBaseDir();
  const dir = path.join(base, "credentials", String(identityId));
  return path.join(dir, "credentials.env");
}

/**
 * 确保凭证目录存在（含父级目录）
 */
function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * 切换到指定管理员的凭证。
 *
 * 解密 AdminIdentity 中存储的 token，写入该身份专用的 .env 文件。
 * CLI 调用时会通过 QQ_AI_CONNECT_DOTENV 指向此文件。
 *
 * 线程安全：每次调用写入独立文件（按 identityId 隔离），无竞态。
 */
export async function switchToIdentity(identityId: bigint | number | null | undefined): Promise<void> {
  if (!identityId) return;

  const identity = await prisma.adminIdentity.findUnique({
    where: { id: BigInt(identityId) },
  });

  if (!identity) {
    console.warn(`[credentials] Admin identity ${identityId} not found`);
    return;
  }

  if (!identity.token) {
    console.warn(`[credentials] Admin identity ${identityId} has no stored token`);
    return;
  }

  const token = decrypt(identity.token).replace(/^["']|["']$/g, "");
  const envPath = getCredentialEnvPath(identity.id);

  ensureDir(path.dirname(envPath));
  // CLI 自身的 .env 格式使用双引号包裹值，保持一致
  const header = "# QQ AI Connect 凭证 — 敏感信息，勿提交到 git。\n";
  fs.writeFileSync(envPath, header + `QQ_AI_CONNECT_TOKEN="${token}"\n`, "utf-8");
  // Restrict file permissions to owner-only (0o600) — prevent other users from reading token
  try { fs.chmodSync(envPath, 0o600); } catch { /* chmod may fail on some platforms */ }

  console.log(`[credentials] Switched to admin identity ${identity.id} (${identity.nickname})`);
}

/**
 * 构建 CLI 调用的环境变量字典。
 *
 * 如果指定了 identityId，会注入 QQ_AI_CONNECT_DOTENV 指向该身份的凭证文件。
 *
 * @param identityId 可选的管理员身份 ID
 * @param extraEnv 额外的环境变量
 */
export function buildCliEnv(
  identityId?: bigint | number | null,
  extraEnv?: Record<string, string>
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
  };

  if (identityId) {
    const dotenvPath = getCredentialEnvPath(identityId);
    // 只当凭证文件存在时才覆盖 DOTENV 路径
    if (fs.existsSync(dotenvPath)) {
      env.QQ_AI_CONNECT_DOTENV = dotenvPath;
    }
  }

  if (extraEnv) {
    Object.assign(env, extraEnv);
  }

  return env;
}

/**
 * 获取当前生效的管理员身份。
 *
 * 从 CLI 凭证目录读取：读取最新写入的 .env 文件对应的身份 ID。
 * 主要用于登录流程执行后的 token 保存。
 *
 * @returns 解密后的 token 字符串，或 null
 */
export function getCurrentToken(): string | null {
  const envPath = path.join(getCredentialBaseDir(), ".env");
  try {
    if (!fs.existsSync(envPath)) return null;
    const content = fs.readFileSync(envPath, "utf-8");
    const match = content.match(/^QQ_AI_CONNECT_TOKEN=(.+)$/m);
    if (!match) return null;
    let token = match[1].trim();
    // CLI 可能在值外包裹双引号，去掉
    if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) {
      token = token.slice(1, -1);
    }
    return token;
  } catch {
    return null;
  }
}

/**
 * 登录完成后，将 CLI 中当前活跃的 token 加密保存到 AdminIdentity。
 *
 * 在 GET /api/cli/login（poll-token 完成）后调用。
 *
 * @param identityId 要保存 token 到的身份 ID
 */
export async function saveCurrentTokenToIdentity(identityId: bigint | number): Promise<void> {
  const token = getCurrentToken();
  if (!token) {
    console.warn("[credentials] No current token found to save");
    return;
  }

  const { encrypt } = await import("@/lib/crypto");
  const encryptedToken = encrypt(token);

  await prisma.adminIdentity.update({
    where: { id: BigInt(identityId) },
    data: { token: encryptedToken },
  });

  console.log(`[credentials] Token saved to admin identity ${identityId}`);
}
