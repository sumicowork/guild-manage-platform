import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import { prisma } from "@/lib/db";
import { switchToIdentity, buildCliEnv } from "./credentials";

const execFileAsync = promisify(execFile);

// ── 限流 & 重试常量（对齐 Python scraper）──────────────────
const MAX_RETRIES = 5;          // 最大重试次数（含 153）
const RETRY_DELAY_S = 3;       // 普通重试间隔（秒）
const RATE_LIMIT_WAIT_S = 30;  // 153 基础等待时间（秒）
const MAX_IDENTITY_SWITCHES = 3; // 单次请求内最多切换身份次数
const IDENTITY_SWITCH_DELAY_MS = 2000; // 切换身份后短延迟（毫秒）

// CLI 超时：poll-token 等操作需要更长，默认 600s
const CLI_TIMEOUT_MS = Number(process.env.CLI_TIMEOUT_MS) || 600_000;

// ── 全局 153 连续计数（跨请求退避）──────────────────────────
let _global153Count = 0;

// ── 请求间隔 ─────────────────────────────────────────────
// 不同 domain.action 独立计时，避免并行 phase 互相阻塞
const REQUEST_DELAY_MS = Number(process.env.CLI_REQUEST_DELAY_MS) || 0;
const _lastCallTimes = new Map<string, number>();

// ── CLI 限流统计（供爬取完成后查询）───────────────────────
const _rateLimitCounts = new Map<string, number>(); // delayKey → 153 次数
export function getRateLimitStats(): Record<string, number> {
  const res: Record<string, number> = {};
  for (const [k, v] of _rateLimitCounts) res[k] = v;
  return res;
}
export function resetRateLimitStats(): void { _rateLimitCounts.clear(); }

// ── 身份池缓存（避免每次调用都查 DB）────────────────────────
interface PoolIdentity {
  id: bigint;
  nickname: string;
}

let _identityPoolCache: PoolIdentity[] = [];
let _poolCacheTime = 0;
const POOL_CACHE_TTL_MS = 60_000; // 1 分钟缓存

// ── Per-identity 限流状态追踪 ─────────────────────────────
interface IdentityRateLimitState {
  consecutive153: number;   // 连续 153 计数
  cooldownUntil: number;    // 冷却到期时间戳 (ms)
  authFailed: boolean;      // 8011 标记：token 失效
}
const _identityStates = new Map<string, IdentityRateLimitState>();

// ── Round-robin 计数器 ────────────────────────────────────
let _roundRobinIndex = 0;

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── 身份池管理 ─────────────────────────────────────────────

/**
 * 获取有 token 的管理员身份池（带缓存）。
 * 用于自动选择和 153 切换。
 * 排除已标记 authFailed 的身份。
 */
async function getIdentityPool(): Promise<PoolIdentity[]> {
  const now = Date.now();
  if (now - _poolCacheTime < POOL_CACHE_TTL_MS && _identityPoolCache.length > 0) {
    return _identityPoolCache;
  }
  _identityPoolCache = await prisma.adminIdentity.findMany({
    where: { token: { not: "" } },
    select: { id: true, nickname: true },
    orderBy: { id: "asc" },
  });
  _poolCacheTime = now;
  return _identityPoolCache;
}

/** 使身份池缓存失效（如新增/删除/重新验证身份后调用） */
export function invalidateIdentityPool(): void {
  _identityPoolCache = [];
  _poolCacheTime = 0;
  // Clear all in-memory authFailed flags — identity health may have changed
  for (const state of _identityStates.values()) {
    state.authFailed = false;
  }
}

// ── Per-identity 限流状态 ──────────────────────────────────

function getIdentityState(id: bigint | number): IdentityRateLimitState {
  const key = String(id);
  let state = _identityStates.get(key);
  if (!state) {
    state = { consecutive153: 0, cooldownUntil: 0, authFailed: false };
    _identityStates.set(key, state);
  }
  return state;
}

function isIdentityInCooldown(id: bigint | number): boolean {
  const state = _identityStates.get(String(id));
  if (!state) return false;
  if (state.authFailed) return true; // 8011: permanently bad until re-login
  return Date.now() < state.cooldownUntil;
}

/**
 * 标记身份进入冷却。
 * 退避时长 = 30s × 2^(consecutive-1)，连续 >3 时至少 300s。
 */
function markIdentityCooldown(id: bigint | number, consecutive: number): void {
  const state = getIdentityState(id);
  state.consecutive153 = consecutive;
  let cooldownS = RATE_LIMIT_WAIT_S * Math.pow(2, consecutive - 1);
  if (consecutive > 3) cooldownS = Math.max(cooldownS, 300);
  state.cooldownUntil = Date.now() + cooldownS * 1000;
}

function resetIdentityCooldown(id: bigint | number): void {
  const state = _identityStates.get(String(id));
  if (state) {
    state.consecutive153 = 0;
    state.cooldownUntil = 0;
  }
}

/** 标记身份 token 失效（8011），不再被选中 */
function markIdentityAuthFailed(id: bigint | number): void {
  const state = getIdentityState(id);
  state.authFailed = true;
}

// ── 自动选择身份（Round-Robin）─────────────────────────────

/**
 * Round-robin 选择一个不在冷却中且未失效的身份。
 * 全部冷却时选冷却最快到期的。
 */
async function autoSelectIdentity(): Promise<PoolIdentity | null> {
  const pool = await getIdentityPool();
  if (pool.length === 0) return null;

  // 从 round-robin 起点开始，找不在冷却中的身份
  for (let i = 0; i < pool.length; i++) {
    const idx = (_roundRobinIndex + i) % pool.length;
    const candidate = pool[idx];
    if (!isIdentityInCooldown(candidate.id)) {
      _roundRobinIndex = idx + 1; // 下次从下一个开始
      return candidate;
    }
  }

  // 全部冷却中 → 选冷却最快到期的（排除 authFailed）
  let earliest: PoolIdentity | null = null;
  let earliestExpiry = Infinity;
  for (const p of pool) {
    const state = _identityStates.get(String(p.id));
    if (state?.authFailed) continue; // skip permanently failed
    const expiry = state?.cooldownUntil ?? 0;
    if (expiry < earliestExpiry) {
      earliestExpiry = expiry;
      earliest = p;
    }
  }
  return earliest;
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

// ── 内部：单次执行（异步，不阻塞事件循环）──────────────

interface CliResult {
  code: number;         // exit code 或 JSON error.code
  message: string;      // 人类可读信息
  data?: any;           // 成功时的 data 字段
  stdout?: string;
  stderr?: string;
  isEnoent?: boolean;
}

async function executeOnce(cliPath: string, args: string[], customEnv?: NodeJS.ProcessEnv): Promise<CliResult> {
  try {
    const { stdout, stderr } = await execFileAsync(cliPath, args, {
      maxBuffer: 100 * 1024 * 1024,
      timeout: CLI_TIMEOUT_MS,
      env: customEnv || { ...process.env },
    });

    const stdoutStr = stdout || "";
    const stderrStr = stderr || "";

    // exit 0 — 解析 JSON
    const parsed = parseOutput(stdoutStr);
    if (parsed && typeof parsed === "object" && "success" in parsed) {
      if ((parsed as any).success) {
        return { code: 0, message: "ok", data: (parsed as any).data ?? parsed, stdout: stdoutStr };
      }
      // success: false — 从 error 字段提取 code
      const errInfo = (parsed as any).error || {};
      return {
        code: errInfo.code ?? -1,
        message: errInfo.hint || errInfo.message || "Unknown",
        stderr: JSON.stringify(errInfo),
        stdout: stdoutStr,
      };
    }

    return { code: 0, message: "ok", data: parsed, stdout: stdoutStr };
  } catch (err: any) {
    // execFile rejects on non-zero exit or spawn errors
    const stdoutStr = err.stdout || "";
    const stderrStr = err.stderr || "";

    // ENOENT — CLI not found
    if (err.code === "ENOENT") {
      return {
        code: -1,
        message: err.message,
        stderr: stderrStr,
        stdout: stdoutStr,
        isEnoent: true,
      };
    }

    // Timed out
    if (err.killed || err.signal === "SIGTERM") {
      return {
        code: -1,
        message: `CLI timed out after ${CLI_TIMEOUT_MS}ms`,
        stderr: stderrStr,
        stdout: stdoutStr,
      };
    }

    // Non-zero exit — try to extract JSON error code from stdout
    const exitCode = err.code ?? -1;
    let jsonCode = exitCode;
    try {
      const parsed = JSON.parse(stdoutStr.trim());
      if (parsed?.error?.code) jsonCode = parsed.error.code;
      else if (parsed?.success === false) jsonCode = parsed?.error?.code ?? exitCode;
    } catch { /* use exitCode */ }

    return {
      code: jsonCode,
      message: stdoutStr.trim().slice(0, 500) || `exit ${exitCode}`,
      stderr: stderrStr.slice(0, 500),
      stdout: stdoutStr,
    };
  }
}

// ── 核心 executor ────────────────────────────────────────

/**
 * Core CLI executor with identity rotation on 153 rate-limit.
 *
 * Executes: `<cli> <domain> <action> [--flags...] --json`
 *
 * Parameters are passed as command-line flags (snake_case → --kebab-case).
 *
 * Rate-limit (153) handling:
 *  - Layer 1: Auto-switch to another identity on 153, retry with 2s delay
 *  - Layer 2: Per-identity cooldown tracking (30s × 2^(n-1), deep 300s)
 *  - Layer 3: Round-robin identity selection for load distribution
 *  - Fallback: exponential backoff when all identities in cooldown
 *
 * Other error codes:
 *  - 151 (auth retry): retry with 3s delay
 *  - 8011 (auth failure): mark identity as failed, try switching; throw if none available
 *  - 10014 (data deleted): return null
 */
export async function executeCli(
  domain: string,
  action: string,
  params?: object,
  adminIdentityId?: bigint | number | null
): Promise<any> {
  const delayKey = domain + "." + action;
  // ── 身份选择 ──
  // 如果调用方指定了身份，直接使用；否则 round-robin 自动选择
  const userSpecifiedIdentity = !!adminIdentityId;
  let currentIdentityId: bigint | number | null = adminIdentityId ?? null;

  if (!currentIdentityId) {
    const selected = await autoSelectIdentity();
    if (selected) {
      currentIdentityId = selected.id;
      console.log(`[CLI] Round-robin selected identity ${currentIdentityId} (${selected.nickname})`);
    } else {
      console.warn(`[CLI] No admin identity with token found in DB — CLI may fail with auth errors`);
    }
  }

  // 切换凭证（写入临时 .env 文件供 CLI 读取）
  if (currentIdentityId) {
    await switchToIdentity(currentIdentityId);
  }

  // 构建环境变量（含凭证路径）— let 因为 153 切换时需要重建
  let cliEnv = buildCliEnv(currentIdentityId);

  // 请求间隔
  // 请求间隔（按 domain.action 独立计时，并行 phase 互不阻塞）
  const now = Date.now();
  const elapsed = now - (_lastCallTimes.get(delayKey) || 0);
  if (elapsed < REQUEST_DELAY_MS) {
    await delay(REQUEST_DELAY_MS - elapsed);
  }
  _lastCallTimes.set(delayKey, Date.now());

  const cliBase = resolveCliPath();
  const flagArgs = params ? buildFlagArgs(params as Record<string, any>) : [];
  const args = [domain, action, ...flagArgs, "--json", "--yes"];

  console.log(`[CLI] ${domain} ${action}: ${args.join(" ")}` + (currentIdentityId ? ` (identity=${currentIdentityId})` : ""));

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

  let rateLimitStreak = 0;      // 当前身份连续 153 计数
  let identitySwitchCount = 0;  // 本次请求内身份切换次数

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const cliPath = resolvePath(cliBase);
    const result = await executeOnce(cliPath, args, cliEnv);

    // ENOENT → Windows .cmd 重试（传递 cliEnv 避免丢失凭证）
    if (result.isEnoent && process.platform === "win32" && !cliPath.endsWith(".cmd")) {
      const retry = await executeOnce(cliPath + ".cmd", args, cliEnv);
      Object.assign(result, retry);
    }

    // ── 成功 ──
    if (result.code === 0) {
      _global153Count = 0;
      if (currentIdentityId) resetIdentityCooldown(currentIdentityId);
      return result.data;
    }

    // ── 153 限流：优先切换身份，否则指数退避 ──
    if (result.code === CliErrorCode.RATE_LIMIT) {
      _rateLimitCounts.set(delayKey, (_rateLimitCounts.get(delayKey) || 0) + 1);
      rateLimitStreak++;
      _global153Count++;

      // 标记当前身份进入冷却
      if (currentIdentityId) {
        markIdentityCooldown(currentIdentityId, rateLimitStreak);
      }

      // Layer 1: 尝试切换到其他身份（仅在未手动指定身份 或 允许自动切换时）
      if (identitySwitchCount < MAX_IDENTITY_SWITCHES) {
        const pool = await getIdentityPool();
        const alternate = pool.find(
          (p) => p.id !== currentIdentityId && !isIdentityInCooldown(p.id)
        );

        if (alternate) {
          identitySwitchCount++;
          console.log(
            `[CLI][限流] 153 on identity ${currentIdentityId}, ` +
            `switching to ${alternate.id} (${alternate.nickname}) ` +
            `[switch #${identitySwitchCount}]`
          );

          // 切换身份
          currentIdentityId = alternate.id;
          await switchToIdentity(currentIdentityId);
          cliEnv = buildCliEnv(currentIdentityId);
          rateLimitStreak = 0; // 新身份重置 streak

          await delay(IDENTITY_SWITCH_DELAY_MS);
          _lastCallTimes.set(delayKey, Date.now());
          continue;
        }

        console.warn(
          `[CLI][限流] No alternate identity available (all in cooldown or pool exhausted)`
        );
      }

      // Layer 2 fallback: 无可用身份，走指数退避
      let waitS = RATE_LIMIT_WAIT_S * Math.pow(2, rateLimitStreak - 1);
      if (_global153Count > 3) {
        waitS = Math.max(waitS, 300);
        console.warn(
          `[CLI][限流] 全局连续 ${_global153Count} 次 153，深度冷却 ${waitS}s...`
        );
      } else {
        console.warn(
          `[CLI][限流] 153 #${rateLimitStreak} (identity ${currentIdentityId})，` +
          `等待 ${waitS}s (尝试 ${attempt}/${MAX_RETRIES})`
        );
      }

      if (attempt < MAX_RETRIES) {
        await delay(waitS * 1000);
        _lastCallTimes.set(delayKey, Date.now());
        continue;
      }

      // 重试耗尽
      throw new CliError(
        `CLI ${domain} ${action} rate-limited after ${MAX_RETRIES} retries`,
        CliErrorCode.RATE_LIMIT,
        result.stderr || ""
      );
    }

    // ── 8011 未登录：标记身份失效，尝试切换 ──
    if (result.code === CliErrorCode.AUTH_FAILURE) {
      if (currentIdentityId) {
        markIdentityAuthFailed(currentIdentityId);
      invalidateIdentityPool();
      }

      // 如果未手动指定身份，尝试切换到其他身份
      if (!userSpecifiedIdentity && identitySwitchCount < MAX_IDENTITY_SWITCHES) {
        const pool = await getIdentityPool();
        const alternate = pool.find(
          (p) => p.id !== currentIdentityId && !isIdentityInCooldown(p.id)
        );
        if (alternate) {
          identitySwitchCount++;
          console.warn(
            `[CLI][8011] Identity ${currentIdentityId} auth failed, ` +
            `switching to ${alternate.id} (${alternate.nickname}) [switch #${identitySwitchCount}]`
          );
          currentIdentityId = alternate.id;
          await switchToIdentity(currentIdentityId);
          cliEnv = buildCliEnv(currentIdentityId);
          continue;
        }
      }

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
      `[CLI] Error ${result.code} on ${domain} ${action}: ${result.message.slice(0, 300)} (尝试 ${attempt}/${MAX_RETRIES})`
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
