import cron, { ScheduledTask } from "node-cron";
import { prisma } from "@/lib/db";
import {
  runFullCrawl,
  runUpdateCrawl,
  runMemberCrawl,
} from "@/services/crawler";

// ─── Configuration ────────────────────────────────────────────────────

/** Default cron expression: every 6 hours */
const DEFAULT_CRON = "0 */6 * * *";

/** Member crawl cron: daily at 3 AM */
const MEMBER_CRON = "0 3 * * *";

// ─── State ────────────────────────────────────────────────────────────

let updateTask: ScheduledTask | null = null;
let memberTask: ScheduledTask | null = null;
let currentUpdateCron = process.env.CRAWL_CRON || DEFAULT_CRON;
let currentMemberCron = process.env.MEMBER_CRON || MEMBER_CRON;

/** Tracks whether a crawl of each type is currently running to prevent overlap */
const runningTasks: Record<string, boolean> = {
  full: false,
  update: false,
  members: false,
};

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

  // Run in background (fire-and-forget)
  runningTasks[type] = true;

  const run = async () => {
    try {
      switch (type) {
        case "full":
          await runFullCrawl(guildId, taskId, adminIdentityId);
          break;
        case "update":
          await runUpdateCrawl(guildId, taskId, adminIdentityId);
          break;
        case "members":
          await runMemberCrawl(guildId, taskId, adminIdentityId);
          break;
      }
    } catch (err) {
      console.error(`[Scheduler] ${type} crawl task #${taskId} failed:`, err);
    } finally {
      runningTasks[type] = false;
    }
  };

  // Don't await — let it run in the background
  run().catch((err) => {
    console.error(`[Scheduler] Unhandled error in ${type} crawl:`, err);
    runningTasks[type] = false;
  });

  return taskId;
}

// ─── Scheduler lifecycle ──────────────────────────────────────────────

/**
 * Initializes the cron-based scheduler.
 * Called once at application startup (e.g., in a layout or server component).
 */
export function initScheduler(): void {
  console.log(`[Scheduler] Initializing with cron: ${currentUpdateCron} (update), ${currentMemberCron} (members)`);

  // Clean up any existing tasks
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
