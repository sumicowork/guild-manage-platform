import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { prisma } from "@/lib/db";
import { switchToIdentity, buildCliEnv } from "./credentials";

// ── 限流 & 重试常量（对齐 Python scraper）──────────────────
const MAX_RETRIES = 5;          // 最大重试次数（含 153）
const RETRY_DELAY_S = 3;       // 普通重试间隔（秒）
const RATE_LIMIT_WAIT_S = 30;  // 153 基础等待时间（秒）

// ── 全局 153 连续计数（跨请求退避）──────────────────────────
let _global153Count = 0;

// ── 请求间隔 ─────────────────────────────────────────────
const REQUEST_DELAY_MS = Number(process.env.CLI_REQUEST_DELAY_MS) || 1500;
let lastCallTime = 0;

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── 工具函数 ─────────────────────────────────────────────

function resolveCliPath(): string {
  const base = process.env.CLI_PATH || "tencent-channel-cli";
  if (path.isAbsolute(base)) {
    if (fs.existsSync(base)) return base;
    if (process.platform === "win32" && fs.existsSync(base + ".cmd"))
      return base + ".cmd";
    return base;
  }
  const localBin = path.join(process.cwd(), "node_modules", ".bin", base);
  if (fs.existsSync(localBin)) return localBin;
  if (process.platform === "win32" && fs.existsSync(localBin + ".cmd"))
    return localBin + ".cmd";
  return base;
}

function parseOutput(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try { return JSON.parse(trimmed); } catch { /* continue */ }
  const lines = trimmed.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    try { return JSON.parse(lines[i].trim()); } catch { continue; }
  }
  return { raw: trimmed };
}

function toFlag(key: string): string {
  return "--" + key.replace(/_/g, "-");
}

function buildFlagArgs(params: Record<string, any>): string[] {
  const args: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === false || value === undefined || value === null) continue;
    const flag = toFlag(key);
    if (value === true) args.push(flag);
    else args.push(flag, String(value));
  }
  return args;
}

// ── 错误类型 ─────────────────────────────────────────────

export enum CliErrorCode {
  RATE_LIMIT = 153,
  AUTH_RETRY = 151,
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

// ── 内部：单次执行（throw 带 code 的 Error）──────────────

interface CliResult {
  code: number;         // exit code 或 JSON error.code
  message: string;      // 人类可读信息
  data?: any;           // 成功时的 data 字段
  stdout?: string;
  stderr?: string;
  isEnoent?: boolean;
}

function executeOnce(cliPath: string, args: string[], customEnv?: NodeJS.ProcessEnv): CliResult {
  const result = spawnSync(cliPath, args, {
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 120_000,
    maxBuffer: 100 * 1024 * 1024,
    env: customEnv || { ...process.env },
  });

  const stdout = result.stdout?.toString("utf-8") || "";
  const stderr = result.stderr?.toString("utf-8") || "";

  // ENOENT / 超时等 spawnSync 错误
  if (result.error) {
    const err = result.error as NodeJS.ErrnoException;
    return {
      code: -1,
      message: err.message,
      stderr,
      stdout,
      isEnoent: err.code === "ENOENT",
    };
  }

  const exitCode = result.status ?? -1;

  // 非零退出码
  if (exitCode !== 0) {
    // 尝试从 stdout 提取 JSON 错误码（CLI 有时 exit 非零但 stdout 有 JSON）
    let jsonCode = exitCode;
    try {
      const parsed = JSON.parse(stdout.trim());
      if (parsed?.error?.code) jsonCode = parsed.error.code;
    } catch { /* use exitCode */ }

    return {
      code: jsonCode,
      message: stdout.trim().slice(0, 300) || `exit ${exitCode}`,
      stderr,
      stdout,
    };
  }

  // exit 0 — 解析 JSON
  const parsed = parseOutput(stdout);
  if (parsed && typeof parsed === "object" && "success" in parsed) {
    if ((parsed as any).success) {
      return { code: 0, message: "ok", data: (parsed as any).data ?? parsed, stdout };
    }
    // success: false — 从 error 字段提取 code
    const errInfo = (parsed as any).error || {};
    return {
      code: errInfo.code ?? -1,
      message: errInfo.hint || errInfo.message || "Unknown",
      stderr: JSON.stringify(errInfo),
      stdout,
    };
  }

  return { code: 0, message: "ok", data: parsed, stdout };
}

// ── 核心 executor ────────────────────────────────────────

/**
 * Core CLI executor.
 *
 * Executes: `<cli> <domain> <action> [--flags...] --json`
 *
 * Parameters are passed as command-line flags (snake_case → --kebab-case).
 *
 * Rate-limit (153) handling — mirrors Python guild_scraper.py:
 *  - Exponential backoff: 30s × 2^(n-1) per consecutive 153
 *  - Global counter across all requests; >3 → deep cooldown (300s+)
 *  - Up to MAX_RETRIES (5) attempts
 *  - Success resets global counter
 *
 * Other error codes:
 *  - 151 (auth retry): retry with 3s delay
 *  - 8011 (auth failure): throw immediately
 *  - 10014 (data deleted): return null
 */
export async function executeCli(
  domain: string,
  action: string,
  params?: object,
  adminIdentityId?: bigint | number | null
): Promise<any> {
  // 如果未指定管理员身份，从数据库自动任选一个（避免依赖 ~/.qqcli 本地凭证）
  let resolvedIdentityId = adminIdentityId ?? null;
  if (!resolvedIdentityId) {
    const anyIdentity = await prisma.adminIdentity.findFirst({
      where: { token: { not: null } },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    if (anyIdentity) {
      resolvedIdentityId = anyIdentity.id;
      console.log(`[CLI] Auto-selected admin identity ${resolvedIdentityId} (no identity specified)`);
    } else {
      console.warn(`[CLI] No admin identity with token found in DB — CLI may fail with auth errors`);
    }
  }

  // 切换凭证（写入临时 .env 文件供 CLI 读取）
  if (resolvedIdentityId) {
    await switchToIdentity(resolvedIdentityId);
  }

  // 构建环境变量（含凭证路径）
  const cliEnv = buildCliEnv(resolvedIdentityId);

  // 请求间隔
  const now = Date.now();
  const elapsed = now - lastCallTime;
  if (elapsed < REQUEST_DELAY_MS) {
    await delay(REQUEST_DELAY_MS - elapsed);
  }
  lastCallTime = Date.now();

  const cliBase = resolveCliPath();
  const flagArgs = params ? buildFlagArgs(params as Record<string, any>) : [];
  const args = [domain, action, ...flagArgs, "--json", "--yes"];

  console.log(`[CLI] ${domain} ${action}: ${args.join(" ")}` + (resolvedIdentityId ? ` (identity=${resolvedIdentityId})` : ""));

  // Windows .cmd fallback 解析
  const resolvePath = (base: string): string => {
    if (
      process.platform === "win32" &&
      !base.endsWith(".cmd") &&
      !fs.existsSync(base) &&
      fs.existsSync(base + ".cmd")
    ) {
      return base + ".cmd";
    }
    return base;
  };

  let rateLimitStreak = 0; // 本次请求内连续 153 计数

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const cliPath = resolvePath(cliBase);
    const result = executeOnce(cliPath, args, cliEnv);

    // ENOENT → Windows .cmd 重试
    if (result.isEnoent && process.platform === "win32" && !cliPath.endsWith(".cmd")) {
      const retry = executeOnce(cliPath + ".cmd", args);
      Object.assign(result, retry);
    }

    // ── 成功 ──
    if (result.code === 0) {
      _global153Count = 0; // 成功重置全局计数
      return result.data;
    }

    // ── 153 限流：指数退避 + 全局深度冷却 ──
    if (result.code === CliErrorCode.RATE_LIMIT) {
      rateLimitStreak++;
      _global153Count++;

      let waitS = RATE_LIMIT_WAIT_S * Math.pow(2, rateLimitStreak - 1);
      if (_global153Count > 3) {
        waitS = Math.max(waitS, 300);
        console.warn(
          `[CLI][限流] 全局连续 ${_global153Count} 次 153，深度冷却 ${waitS}s...`
        );
      } else {
        console.warn(
          `[CLI][限流] 153 #${rateLimitStreak}，等待 ${waitS}s (尝试 ${attempt}/${MAX_RETRIES})`
        );
      }

      if (attempt < MAX_RETRIES) {
        await delay(waitS * 1000);
        lastCallTime = Date.now();
        continue;
      }
      // 重试耗尽
      throw new CliError(
        `CLI ${domain} ${action} rate-limited after ${MAX_RETRIES} retries`,
        CliErrorCode.RATE_LIMIT,
        result.stderr || ""
      );
    }

    // ── 8011 未登录：不可恢复 ──
    if (result.code === CliErrorCode.AUTH_FAILURE) {
      throw new CliError(
        `CLI auth failure on ${domain} ${action}: token may be expired`,
        CliErrorCode.AUTH_FAILURE,
        result.stderr || result.message
      );
    }

    // ── 10014 数据已删除：静默返回 ──
    if (result.code === CliErrorCode.DATA_DELETED) {
      console.warn(`[CLI] Data deleted (10014) for ${domain} ${action}.`);
      return null;
    }

    // ── 151 登录态验证失败：短延迟重试 ──
    if (result.code === CliErrorCode.AUTH_RETRY) {
      console.warn(
        `[CLI] Auth retry (151) on ${domain} ${action}, ${RETRY_DELAY_S}s (尝试 ${attempt}/${MAX_RETRIES})`
      );
      if (attempt < MAX_RETRIES) {
        await delay(RETRY_DELAY_S * 1000);
        continue;
      }
    }

    // ── 其他错误：短延迟重试 ──
    console.warn(
      `[CLI] Error ${result.code} on ${domain} ${action}: ${result.message.slice(0, 200)} (尝试 ${attempt}/${MAX_RETRIES})`
    );
    if (attempt < MAX_RETRIES) {
      await delay(RETRY_DELAY_S * 1000);
      continue;
    }
  }

  // 所有重试耗尽
  throw new CliError(
    `CLI ${domain} ${action} failed after ${MAX_RETRIES} attempts`,
    -1, ""
  );
}
