import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import {
  getAuthUser,
  unauthorized,
  forbidden,
  success,
  error,
  serializeBigInt,
} from "@/lib/api-utils";

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return unauthorized();

    if (auth.role !== "admin") {
      return forbidden();
    }

    const body = await req.json();
    const { taskType } = body;

    if (!taskType || !["full", "update", "members"].includes(taskType)) {
      return error("taskType 必须是 full、update 或 members 之一", 400);
    }

    const task = await prisma.crawlTask.create({
      data: {
        task_type: taskType,
        status: "pending",
        triggered_by: "manual",
        triggered_by_user: BigInt(auth.userId),
      },
    });

    return success(serializeBigInt(task));
  } catch (err) {
    console.error("Crawl trigger error:", err);
    return error("触发爬取任务失败", 500);
  }
}
