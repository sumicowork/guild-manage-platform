import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, success, error, serializeBigInt, toCamelCase } from "@/lib/api-utils";

export async function GET(
  req: NextRequest,
  ctx: RouteContext<"/api/crawl/tasks/[id]">
) {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return unauthorized();

    const { id } = await ctx.params;
    const taskId = BigInt(id);

    const task = await prisma.crawlTask.findUnique({
      where: { id: taskId },
    });

    if (!task) {
      return error("爬取任务不存在", 404);
    }

    const rawTask = serializeBigInt(task);
    const camelTask = toCamelCase(rawTask) as any;
    const mapped = {
      ...camelTask,
      type: camelTask.taskType,
      trigger: camelTask.triggeredBy,
      completedAt: camelTask.finishedAt ?? null,
      errorMessage: camelTask.errorLog ?? null,
    };

    return success(mapped);
  } catch (err) {
    console.error("Crawl task detail error:", err);
    return error("获取爬取任务详情失败", 500);
  }
}
