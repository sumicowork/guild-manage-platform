import cron, { ScheduledTask } from "node-cron";
import { prisma } from "@/lib/db";
import {
  runFullCrawl,
  runUpdateCrawl,
  runMemberCrawl,
  CrawlCancelledError,
} from "@/services/crawler";
import { runIdentityHealthCheck } from "@/services/identity-health";
import fs from "fs";
import path from "path";

// ─── Configuration ────────────────────────────────────────────────────

/** Default cron expression: every 6 hours */
const DEFAULT_CRON = "* * * * *";

/** Member crawl cron: daily at 3 AM */
const MEMBER_CRON = "*/10 * * * *";

/** 深夜全量（deep）爬取：每天 3:30，清历史欠账 */
const DEFAULT_DEEP_CRON = "30 3 * * *";

/**
 * 配置文件路径：standalone 部署时 server.js 执行 process.chdir(__dirname)
 * （cwd = .next/standalone），必须回退到项目根才能读到真实配置。
 * 探测顺序：cwd（本地开发）→ cwd 上两级（standalone 部署）。
 */
function resolveConfigFile(): string {
  const candidates = [
    path.join(process.cwd(), ".crawl_config.json"),
    path.join(process.cwd(), "..", "..", ".crawl_config.json"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0];
}

/** File to persist cron settings across restarts */
const CONFIG_FILE = resolveConfigFile();

function readPersistedCron(): { update?: string; member?: string; update_deep?: string } {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
    }
  } catch { /* ignore */ }
  return {};
}

function writePersistedCron(update?: string, member?: string, updateDeep?: string): void {
  try {
    const existing = readPersistedCron();
    if (update !== undefined) existing.update = update;
    if (member !== undefined) existing.member = member;
    if (updateDeep !== undefined) existing.update_deep = updateDeep;
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(existing), "utf-8");
  } catch { /* ignore */ }
}

// ─── State ────────────────────────────────────────────────────────────

// Priority: env var > persisted file > default
const persisted = readPersistedCron();
let updateTask: ScheduledTask | null = null;
let updateDeepTask: ScheduledTask | null = null;
let memberTask: ScheduledTask | null = null;
let identityCheckTask: ScheduledTask | null = null;
let currentUpdateCron = process.env.CRAWL_CRON || persisted.update || DEFAULT_CRON;
let currentMemberCron = process.env.MEMBER_CRON || persisted.member || MEMBER_CRON;
let currentUpdateDeepCron = process.env.CRAWL_DEEP_CRON || persisted.update_deep || DEFAULT_DEEP_CRON;

/** Tracks running tasks for frontend display (real lock is DB-based in triggerCrawl) */
const runningTasks: Record<string, boolean> = {
  full: false,
  update: false,
  members: false,
};

/** Tracks AbortControllers for currently running tasks, keyed by task ID (as string).
 *  Used by cancelCrawl() to signal cancellation to in-flight crawls. */
const _abortControllers: Map<string, AbortController> = new Map();

// ─── Core trigger ─────────────────────────────────────────────────────

/**
 * Creates a CrawlTask record and starts the crawl in the background.
 *
 * @param type         Crawl type: 'full' | 'update' | 'members'
 * @param triggeredBy  'manual' or 'cron'
 * @param userId       Optional platform user ID who triggered it
 * @param adminIdentityId  Optional admin identity ID for CLI credential switching
 * @param mode         update 任务模式："light"（每分钟，扫最新几页）| "deep"（深夜全量补欠账）
 * @returns The created task's BigInt ID
 */
export async function triggerCrawl(
  type: "full" | "update" | "members",
  triggeredBy: "manual" | "cron",
  userId?: number,
  adminIdentityId?: number,
  mode?: "light" | "deep"
): Promise<bigint> {
  // DB-based lock: 按类型/模式互斥（avoids Next.js bundle chunk isolation issue）
  // 冲突矩阵（existing 正在运行 → 是否阻止 incoming 启动）：
  //   · full          阻止一切（含自身）
  //   · incoming=full 被任何 running 阻止
  //   · deep          仅与 full / deep 互斥（不与 light / members 互斥）
  //   · light/members 仅被 full 阻止（彼此、以及 deep 均不互斥 → 3:30 deep 与 light 可并发）
  // 关键修复：旧逻辑「有任何 running 就拒绝」导致 3:30 的 deep 被同分钟的
  //           light/members 抢锁饿死（实测每天失败）。现 deep 不再被 light/members 挡。
  // 注意：update 任务靠 mode 区分 light/deep；历史任务 mode 为 NULL（旧代码未记录），
  //       视为非 deep，不会误挡新 deep（保证 3:30 deep 能跑起来）。
  const conflictWhere: any = { status: { in: ["pending", "running"] } };
  if (type !== "full") {
    const incomingIsDeep = type === "update" && mode === "deep";
    conflictWhere.OR = [
      { task_type: "full" },
      ...(incomingIsDeep ? [{ task_type: "update", mode: "deep" }] : []),
    ];
  }
  const existing = await prisma.crawlTask.findFirst({
    where: conflictWhere,
    select: { id: true, task_type: true, status: true, mode: true },
  });
  if (existing) {
    throw new Error(
      `无法启动 ${type}${mode ? `(${mode})` : ""} 爬取：已有冲突任务 ${existing.task_type}${existing.mode ? `(${existing.mode})` : ""} (ID=${existing.id}, ${existing.status}) 正在运行中`
    );
  }

  const guildId = process.env.GUILD_ID || "";

  // Create the task record
  const task = await prisma.crawlTask.create({
    data: {
      task_type: type,
      mode: mode ?? null,
      status: "pending",
      triggered_by: triggeredBy,
      triggered_by_user: userId ? BigInt(userId) : null,
      created_at: new Date(),
    },
  });

  // 原子领取：仅当仍为 pending（未被并发方抢占）时置 running。
  // 若两个请求同时通过上面的检查，只有一个能领取成功，另一个任务被标记 cancelled。
  const claim = await prisma.crawlTask.updateMany({
    where: { id: task.id, status: "pending" },
    data: { status: "running" },
  });
  if (claim.count !== 1) {
    await prisma.crawlTask
      .update({ where: { id: task.id }, data: { status: "cancelled", finished_at: new Date(), error_log: "锁竞争失败，未实际运行" } })
      .catch(() => {});
    throw new Error(`无法启动 ${type} 爬取：任务 ${task.id} 未获取到运行锁`);
  }

  const taskId = task.id;
  console.log(`[Scheduler] Created ${type} crawl task #${taskId}`);

  // Don't await — let it run in the background
  runningTasks[type] = true;

  const controller = new AbortController();
  const taskIdStr = String(taskId);
  _abortControllers.set(taskIdStr, controller);

  const run = async () => {
    try {
      switch (type) {
        case "full":
          await runFullCrawl(guildId, taskId, adminIdentityId, controller.signal);
          break;
        case "update":
          await runUpdateCrawl(guildId, taskId, adminIdentityId, controller.signal, { mode });
          break;
        case "members":
          await runMemberCrawl(guildId, taskId, adminIdentityId, controller.signal);
          break;
      }
    } catch (err) {
      if (err instanceof CrawlCancelledError) {
        console.log(`[Scheduler] ${type} crawl task #${taskId} was cancelled by user`);
        try {
          await prisma.crawlTask.update({
            where: { id: taskId },
            data: {
              status: "cancelled",
              finished_at: new Date(),
              error_log: "Cancelled by user via /api/crawl/cancel",
            },
          });
        } catch (updateErr) {
          console.error(`[Scheduler] Failed to mark task #${taskId} as cancelled:`, updateErr);
        }
      } else {
        console.error(`[Scheduler] ${type} crawl task #${taskId} failed:`, err);
        try {
          await prisma.crawlTask.update({
            where: { id: taskId },
            data: {
              status: "failed",
              finished_at: new Date(),
              error_log: err instanceof Error ? err.message : String(err),
            },
          });
        } catch (updateErr) {
          console.error(`[Scheduler] Failed to mark task #${taskId} as failed:`, updateErr);
        }
      }
    } finally {
      runningTasks[type] = false;
      _abortControllers.delete(taskIdStr);
    }
  };

  // Don't await — let it run in the background
  run().catch((err) => {
    console.error(`[Scheduler] Unhandled error in ${type} crawl:`, err);
    runningTasks[type] = false;
    _abortControllers.delete(taskIdStr);
  });

  return taskId;
}

// ─── Cancellation ────────────────────────────────────────────────────

/**
 * Cancels a running crawl task by ID.
 * Aborts the in-flight crawl via AbortSignal; the crawler cooperatively
 * unwinds at the next loop checkpoint and the task is marked 'cancelled'.
 *
 * @param taskId  The task ID to cancel
 * @returns true if a controller was found and aborted, false if no running task matches
 */
export function cancelCrawl(taskId: bigint): boolean {
  const taskIdStr = String(taskId);
  const controller = _abortControllers.get(taskIdStr);
  if (!controller) return false;
  controller.abort();
  return true;
}

// ─── Scheduler lifecycle ──────────────────────────────────────────────

/**
 * Initializes the cron-based scheduler.
 * Called once at application startup (e.g., in a layout or server component).
 */
export async function initScheduler(): Promise<void> {
  console.log(`[Scheduler] Initializing with cron: ${currentUpdateCron} (update), ${currentMemberCron} (members)`);

  // Clean up zombie tasks left in "running" state from previous server lifetime
  //（pending 也在锁范围内，create 后未领取即崩溃的任务同样回收）
  try {
    const result = await prisma.crawlTask.updateMany({
      where: { status: "running" },
      data: { status: "interrupted", finished_at: new Date(), error_log: "Server restarted while task was running" },
    });
    if (result.count > 0) {
      console.log(`[Scheduler] Cleaned up ${result.count} zombie task(s) left in 'running' state`);
    }
    const stalePending = await prisma.crawlTask.updateMany({
      where: { status: "pending", created_at: { lt: new Date(Date.now() - 6 * 3600 * 1000) } },
      data: { status: "interrupted", finished_at: new Date(), error_log: "Stale pending task (crashed before claim)" },
    });
    if (stalePending.count > 0) {
      console.log(`[Scheduler] Cleaned up ${stalePending.count} stale pending task(s)`);
    }
  } catch (err) {
    console.error("[Scheduler] Failed to clean up zombie tasks:", err);
  }

  // Clean up any existing scheduled tasks
  destroyScheduler();

  // Schedule update crawl（light 模式：每分钟轻量扫描，保证实时性）
  if (cron.validate(currentUpdateCron)) {
    updateTask = cron.schedule(currentUpdateCron, async () => {
      console.log(`[Scheduler] Cron triggered: update crawl (light)`);
      try {
        await triggerCrawl("update", "cron", undefined, undefined, "light");
      } catch (err) {
        console.error("[Scheduler] Failed to trigger update crawl:", err);
      }
    });
    console.log(`[Scheduler] Update crawl (light) scheduled: ${currentUpdateCron}`);
  } else {
    console.warn(`[Scheduler] Invalid update cron expression: ${currentUpdateCron}`);
  }

  // Schedule deep update crawl（每天凌晨全量深扫，清历史欠账）
  if (cron.validate(currentUpdateDeepCron)) {
    updateDeepTask = cron.schedule(currentUpdateDeepCron, async () => {
      console.log(`[Scheduler] Cron triggered: update crawl (deep)`);
      try {
        await triggerCrawl("update", "cron", undefined, undefined, "deep");
      } catch (err) {
        console.error("[Scheduler] Failed to trigger deep update crawl:", err);
      }
    });
    console.log(`[Scheduler] Update crawl (deep) scheduled: ${currentUpdateDeepCron}`);
  } else {
    console.warn(`[Scheduler] Invalid deep update cron expression: ${currentUpdateDeepCron}`);
  }

  // Schedule member crawl
  if (cron.validate(currentMemberCron)) {
    memberTask = cron.schedule(currentMemberCron, async () => {
      console.log(`[Scheduler] Cron triggered: member crawl`);
      try {
        await triggerCrawl("members", "cron");
      } catch (err) {
        console.error("[Scheduler] Failed to trigger member crawl:", err);
      }
    });
    console.log(`[Scheduler] Member crawl scheduled: ${currentMemberCron}`);
  } else {
    console.warn(`[Scheduler] Invalid member cron expression: ${currentMemberCron}`);
  }

  // Schedule identity health check — every 30 minutes
  identityCheckTask = cron.schedule("*/30 * * * *", async () => {
    try {
      await runIdentityHealthCheck();
    } catch (err) {
      console.error("[Scheduler] Identity health check failed:", err);
    }
  });
  console.log("[Scheduler] Identity health check scheduled: every 30 minutes");
}

/**
 * Stops all scheduled tasks.
 */
export function destroyScheduler(): void {
  if (updateTask) {
    updateTask.stop();
    updateTask = null;
  }
  if (updateDeepTask) {
    updateDeepTask.stop();
    updateDeepTask = null;
  }
  if (memberTask) {
    memberTask.stop();
    memberTask = null;
  }
  if (identityCheckTask) {
    identityCheckTask.stop();
    identityCheckTask = null;
  }
  console.log("[Scheduler] All scheduled tasks stopped");
}

// ─── Schedule management ─────────────────────────────────────────────

/**
 * Updates the cron schedule for the update crawl.
 * Restarts the scheduled task with the new expression.
 *
 * @param cronExpr  New cron expression, e.g. "0 0 4 * *"
 */
export function updateCrawlSchedule(cronExpr: string): void {
  if (!cron.validate(cronExpr)) {
    throw new Error(`Invalid cron expression: ${cronExpr}`);
  }

  currentUpdateCron = cronExpr;
  writePersistedCron(cronExpr, undefined);
  console.log(`[Scheduler] Updating crawl schedule to: ${cronExpr}`);

  // Restart the update task
  if (updateTask) {
    updateTask.stop();
    updateTask = null;
  }

  updateTask = cron.schedule(currentUpdateCron, async () => {
    console.log(`[Scheduler] Cron triggered: update crawl (light)`);
    try {
      await triggerCrawl("update", "cron", undefined, undefined, "light");
    } catch (err) {
      console.error("[Scheduler] Failed to trigger update crawl:", err);
    }
  });
}

/**
 * Updates the cron schedule for the member crawl.
 *
 * @param cronExpr  New cron expression
 */
export function updateMemberSchedule(cronExpr: string): void {
  if (!cron.validate(cronExpr)) {
    throw new Error(`Invalid cron expression: ${cronExpr}`);
  }

  currentMemberCron = cronExpr;
  writePersistedCron(undefined, cronExpr);
  console.log(`[Scheduler] Updating member schedule to: ${cronExpr}`);

  if (memberTask) {
    memberTask.stop();
    memberTask = null;
  }

  memberTask = cron.schedule(currentMemberCron, async () => {
    console.log(`[Scheduler] Cron triggered: member crawl`);
    try {
      await triggerCrawl("members", "cron");
    } catch (err) {
      console.error("[Scheduler] Failed to trigger member crawl:", err);
    }
  });
}

/**
 * Returns the current schedule configuration.
 */
export function getScheduleInfo(): {
  updateCron: string;
  memberCron: string;
  runningTasks: Record<string, boolean>;
} {
  return {
    updateCron: currentUpdateCron,
    memberCron: currentMemberCron,
    runningTasks: { ...runningTasks },
  };
}
