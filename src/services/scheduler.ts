import cron, { ScheduledTask } from "node-cron";
import { prisma } from "@/lib/db";
import {
  runFullCrawl,
  runUpdateCrawl,
  runMemberCrawl,
  CrawlCancelledError,
} from "@/services/crawler";
import fs from "fs";
import path from "path";

// ─── Configuration ────────────────────────────────────────────────────

/** Default cron expression: every 6 hours */
const DEFAULT_CRON = "0 */6 * * *";

/** Member crawl cron: daily at 3 AM */
const MEMBER_CRON = "0 3 * * *";

/** File to persist cron settings across restarts */
const CONFIG_FILE = path.join(process.cwd(), ".crawl_config.json");

function readPersistedCron(): { update?: string; member?: string } {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
    }
  } catch { /* ignore */ }
  return {};
}

function writePersistedCron(update?: string, member?: string): void {
  try {
    const existing = readPersistedCron();
    if (update !== undefined) existing.update = update;
    if (member !== undefined) existing.member = member;
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(existing), "utf-8");
  } catch { /* ignore */ }
}

// ─── State ────────────────────────────────────────────────────────────

// Priority: env var > persisted file > default
const persisted = readPersistedCron();
let updateTask: ScheduledTask | null = null;
let memberTask: ScheduledTask | null = null;
let currentUpdateCron = process.env.CRAWL_CRON || persisted.update || DEFAULT_CRON;
let currentMemberCron = process.env.MEMBER_CRON || persisted.member || MEMBER_CRON;

/** Tracks whether a crawl of each type is currently running to prevent overlap */
const runningTasks: Record<string, boolean> = {
  full: false,
  update: false,
  members: false,
};

/** Global lock: only one crawl of any type runs at a time to avoid CLI rate-limit (153) */
let _anyCrawlRunning = false;

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
 * @returns The created task's BigInt ID
 */
export async function triggerCrawl(
  type: "full" | "update" | "members",
  triggeredBy: "manual" | "cron",
  userId?: number,
  adminIdentityId?: number
): Promise<bigint> {
  // Prevent concurrent crawls of the same type
  if (runningTasks[type]) {
    throw new Error(
      `A ${type} crawl is already running. Please wait for it to finish.`
    );
  }

  // Global lock: prevent any concurrent crawl to avoid CLI 153 rate-limit
  if (_anyCrawlRunning) {
    throw new Error(
      `Another crawl is currently running. Please wait for it to finish before starting a ${type} crawl.`
    );
  }

  const guildId = process.env.GUILD_ID || "";

  // Create the task record
  const task = await prisma.crawlTask.create({
    data: {
      task_type: type,
      status: "pending",
      triggered_by: triggeredBy,
      triggered_by_user: userId ? BigInt(userId) : null,
      created_at: new Date(),
    },
  });

  const taskId = task.id;
  console.log(`[Scheduler] Created ${type} crawl task #${taskId}`);

  // Don't await — let it run in the background
  _anyCrawlRunning = true;
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
          await runUpdateCrawl(guildId, taskId, adminIdentityId, controller.signal);
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
      }
    } finally {
      runningTasks[type] = false;
      _anyCrawlRunning = false;
      _abortControllers.delete(taskIdStr);
    }
  };

  // Don't await — let it run in the background
  run().catch((err) => {
    console.error(`[Scheduler] Unhandled error in ${type} crawl:`, err);
    runningTasks[type] = false;
    _anyCrawlRunning = false;
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
  try {
    const result = await prisma.crawlTask.updateMany({
      where: { status: "running" },
      data: { status: "interrupted", finished_at: new Date(), error_log: "Server restarted while task was running" },
    });
    if (result.count > 0) {
      console.log(`[Scheduler] Cleaned up ${result.count} zombie task(s) left in 'running' state`);
    }
  } catch (err) {
    console.error("[Scheduler] Failed to clean up zombie tasks:", err);
  }

  // Clean up any existing scheduled tasks
  destroyScheduler();

  // Schedule update crawl
  if (cron.validate(currentUpdateCron)) {
    updateTask = cron.schedule(currentUpdateCron, async () => {
      console.log(`[Scheduler] Cron triggered: update crawl`);
      try {
        await triggerCrawl("update", "cron");
      } catch (err) {
        console.error("[Scheduler] Failed to trigger update crawl:", err);
      }
    });
    console.log(`[Scheduler] Update crawl scheduled: ${currentUpdateCron}`);
  } else {
    console.warn(`[Scheduler] Invalid update cron expression: ${currentUpdateCron}`);
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
}

/**
 * Stops all scheduled tasks.
 */
export function destroyScheduler(): void {
  if (updateTask) {
    updateTask.stop();
    updateTask = null;
  }
  if (memberTask) {
    memberTask.stop();
    memberTask = null;
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
    console.log(`[Scheduler] Cron triggered: update crawl`);
    try {
      await triggerCrawl("update", "cron");
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
