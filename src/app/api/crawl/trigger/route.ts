import { NextRequest } from "next/server";
import {
  getAuthUser,
  unauthorized,
  forbidden,
  success,
  error,
  serializeBigInt,
  toCamelCase,
} from "@/lib/api-utils";
import { prisma } from "@/lib/db";
import { triggerCrawl } from "@/services/scheduler";

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return unauthorized();

    if (auth.role !== "admin") {
      return forbidden();
    }

    const body = await req.json();
    const { type } = body;
    // Map client values: "incremental" → "update"
    const taskType = type === "incremental" ? "update" : type;

    if (!taskType || !["full", "update", "members"].includes(taskType)) {
      return error("type 必须是 full、incremental 或 members 之一", 400);
    }

    // Use scheduler to create task and start crawl in background
    const taskId = await triggerCrawl(
      taskType as "full" | "update" | "members",
      "manual",
      Number(auth.userId)
    );

    // Fetch the created task to return
    const task = await prisma.crawlTask.findUnique({
      where: { id: taskId },
    });

    if (!task) {
      return error("任务创建失败", 500);
    }

    const rawTask = serializeBigInt(task);
    const camelTask = toCamelCase(rawTask) as any;
    const mapped = {
      ...camelTask,
      type: camelTask.taskType,
      trigger: camelTask.triggeredBy,
      startedAt: camelTask.startedAt,
      completedAt: camelTask.finishedAt ?? null,
      errorMessage: camelTask.errorLog ?? null,
    };
    return success(mapped);
  } catch (err) {
    console.error("Crawl trigger error:", err);
    if (err instanceof Error && err.message.includes("already running")) {
      return error(err.message, 409);
    }
    return error("触发爬取任务失败", 500);
  }
}
