import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import {
  getAuthUser,
  unauthorized,
  forbidden,
  success,
  error,
  serializeBigInt,
  toCamelCase,
} from "@/lib/api-utils";

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

    const task = await prisma.crawlTask.create({
      data: {
        task_type: taskType,
        status: "pending",
        triggered_by: "manual",
        triggered_by_user: BigInt(auth.userId),
      },
    });

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
    return error("触发爬取任务失败", 500);
  }
}
