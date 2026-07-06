/**
 * 153 Probe — 在本地探测评论和详情 API 的安全延迟
 *
 * 保守参数：
 *   - 每级 300 次调用 (~10min@2s)
 *   - 撞后冷却 30min
 *   - 步长 200ms
 *   - 同一延迟撞满 5 次才放弃
 *   - 级间冷却 20min
 *
 * 用法: npx tsx scripts/probe-153.ts
 * 日志: logs/probe-153-YYYYMMDD-HHmmss.log
 */

import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import "dotenv/config";

// ── Config ──

const GUILD_ID = process.env.GUILD_ID || "";
const STEPS = 300;
const HIT_COOLDOWN_S = 30 * 60;
const LEVEL_COOLDOWN_S = 20 * 60;
const HIT_CONFIRM = 5;
const START_DELAY_MS = 2000;
const STEP_MS = 200;
const MIN_DELAY_MS = 200;

// CLI path for exec (shell-compatible)
const CLI_CMD = "tencent-channel-cli"; // works in Git Bash / Linux PATH

// ── Logger ──

const now = new Date();
const ts = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
const logDir = path.resolve(process.cwd(), "logs");
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
const logPath = path.join(logDir, `probe-153-${ts}.log`);

function log(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(logPath, line + "\n");
}

// ── Identity ──

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function getIdentity() {
  const ident = await prisma.adminIdentity.findFirst({
    select: { id: true, nickname: true },
    orderBy: { id: "asc" },
  });
  if (!ident) throw new Error("No active identity found");
  return ident;
}

// ── CLI call ──

// Build env with credentials for a specific identity
import { buildCliEnv } from "../src/lib/cli/credentials";

async function callCli(domain: string, action: string, params: string[], identityId: bigint): Promise<{ ok: boolean; code?: number; stderr?: string }> {
  const env = { ...process.env, ...buildCliEnv(identityId) };
  const paramStr = params.join(" ");
  const cmd = `${CLI_CMD} ${domain} ${action} ${paramStr} --json --yes`;
  try {
    const execAsync = promisify(exec);
    const { stdout, stderr } = await execAsync(cmd, {
      maxBuffer: 100 * 1024 * 1024,
      timeout: 30_000,
      env,
    });
    const parsed = JSON.parse(stdout || "{}");
    if (parsed.success) return { ok: true };
    return { ok: false, stderr: stderr || stdout };
  } catch (err: any) {
    const stderr = err.stderr || err.message || "";
    const code = err.code || (stderr.match(/(?:code|exit)[:\s]*(\d+)/i)?.[1]);
    return { ok: false, code: typeof code === "number" ? code : (code ? parseInt(code) : undefined), stderr };
  }
}

// ── Probe logic ──

async function probe(domain: string, action: string, params: string[], identityId: bigint, delayMs: number, count: number): Promise<{ ok: number; hit153: number; other: number }> {
  let ok = 0, hit153 = 0, other = 0;
  for (let i = 0; i < count; i++) {
    const start = Date.now();
    const result = await callCli(domain, action, params, identityId);
    const elapsed = Date.now() - start;

    if (result.ok) {
      ok++;
    } else if (result.code === 153) {
      hit153++;
      log(`  #${i + 1} ⚠ 153 (${elapsed}ms)`);
      // On 153, stop immediately — don't keep hammering
      break;
    } else {
      other++;
      log(`  #${i + 1} ✗ code=${result.code ?? "?"} ${result.stderr?.slice(0, 80)}`);
    }

    // Show progress every 50
    if ((i + 1) % 50 === 0 && ok > 0) {
      log(`  ${i + 1}/${count} | OK:${ok}` + (hit153 > 0 ? ` 153:${hit153}` : ""));
    }

    // Fixed delay
    const wait = delayMs - elapsed;
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
  }
  return { ok, hit153, other };
}

async function cooldown(seconds: number, label: string) {
  log(`[COOL] ${label}: waiting ${Math.floor(seconds / 60)}m${seconds % 60}s...`);
  // Sleep in 10s chunks so we don't block
  for (let remain = seconds; remain > 0; remain -= 10) {
    await new Promise(r => setTimeout(r, Math.min(10, remain) * 1000));
  }
  log(`[COOL] ${label}: done`);
}

// ── Main ──

async function main() {
  log("╔══════════════════════════════════════════╗");
  log("║     153 PROBE — Rate Limit Tester       ║");
  log("╠══════════════════════════════════════════╣");
  log(`║ STEPS: ${STEPS} per level`);
  log(`║ HIT_COOLDOWN: ${HIT_COOLDOWN_S}s`);
  log(`║ LEVEL_COOLDOWN: ${LEVEL_COOLDOWN_S}s`);
  log(`║ HIT_CONFIRM: ${HIT_CONFIRM}`);
  log(`║ START_DELAY: ${START_DELAY_MS}ms`);
  log(`║ STEP: ${STEP_MS}ms`);
  log("╚══════════════════════════════════════════╝");

  const identity = await getIdentity();
  log(`Identity: #${identity.id} (${identity.nickname})`);

  // Find a test feed
  const feed = await prisma.feed.findFirst({
    where: { comment_count: { gte: 1 } },
    select: { feed_id: true, comment_count: true },
    orderBy: { comment_count: "desc" },
  });
  if (!feed) throw new Error("No feed with comments found");
  const feedId = feed.feed_id;
  log(`Test feed: ${feedId} (${feed.comment_count} comments)`);

  // Pre-flight: test CLI works
  log("Pre-flight check...");
  const pf = await callCli("feed", "get-feed-comments", [`--feed-id=${feedId}`, `--guild-id=${GUILD_ID}`, "--count=1", "--reply-list-num=0"], identity.id);
  if (!pf.ok) {
    log(`FATAL: CLI test failed: code=${pf.code} ${pf.stderr?.slice(0, 200)}`);
    process.exit(1);
  }
  log("Pre-flight OK");

  // Test phases
  const phases = [
    { name: "getFeedComments", domain: "feed", action: "get-feed-comments", params: [`--feed-id=${feedId}`, `--guild-id=${GUILD_ID}`, "--count=1", "--reply-list-num=0"] },
    { name: "getFeedDetail",   domain: "feed", action: "get-feed-detail",   params: [`--feed-id=${feedId}`, `--guild-id=${GUILD_ID}`] },
  ];

  for (const phase of phases) {
    log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    log(`Phase: ${phase.name}`);
    log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    let delayMs = START_DELAY_MS;

    while (delayMs >= MIN_DELAY_MS) {
      log(`\n→ Testing delay=${delayMs}ms...`);

      let hitCount = 0;

      for (let attempt = 1; attempt <= HIT_CONFIRM; attempt++) {
        if (attempt > 1) {
          log(`  ── 确认 #${attempt}/${HIT_CONFIRM} (同延迟重试，验证是否稳定触发 153) ──`);
          await cooldown(HIT_COOLDOWN_S, `撞后冷却 (153 confirm #${attempt})`);
        }

        const result = await probe(phase.domain, phase.action, phase.params, identity.id, delayMs, STEPS);
        log(`  Result: OK=${result.ok} 153=${result.hit153} other=${result.other}`);

        if (result.hit153 === 0) {
          log(`  ✓ 安全通过 (delay=${delayMs}ms)`);
          if (attempt > 1) {
            log(`  ⚠ 注意: 之前触发过 153，但重试通过 — 可能是偶发，继续`);
          }
          break; // Passed, move to next delay
        } else {
          hitCount++;
          log(`  ⚠ 153 after ${result.ok + result.hit153} calls (attempt ${attempt}/${HIT_CONFIRM})`);
          if (hitCount >= HIT_CONFIRM) {
            log(`  ✗ CONFIRMED: delay=${delayMs}ms 不稳定，放弃`);
            delayMs = delayMs + STEP_MS * 2; // 回退两档，设为最终值
            log(`  → Final safe delay for ${phase.name}: ${delayMs}ms`);
            break;
          }
          // Continue to next attempt (after cooldown in loop start)
        }
      }

      // Stop if we confirmed 153 at this level
      if (hitCount >= HIT_CONFIRM) break;

      // Move to next level
      const prevDelay = delayMs;
      delayMs -= STEP_MS;
      if (delayMs >= MIN_DELAY_MS && hitCount === 0) {
        await cooldown(LEVEL_COOLDOWN_S, `级间冷却 (${prevDelay}ms → ${delayMs}ms)`);
      }
    }

    log(`\nFinal ${phase.name}: delay=${delayMs}ms (safe)`);

    // Between APIs: long rest
    if (phase !== phases[phases.length - 1]) {
      await cooldown(HIT_COOLDOWN_S, `API 间冷却 (切换到下一个 API)`);
    }
  }

  log("\n═══════════════════════════════════════════");
  log("Probe complete. Log: " + logPath);
  log("═══════════════════════════════════════════");
  await prisma.$disconnect();
}

main().catch(async (err) => {
  log(`FATAL: ${err instanceof Error ? err.message : String(err)}`);
  await prisma.$disconnect();
  process.exit(1);
});
