import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, success, error, serializeBigInt } from "@/lib/api-utils";

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

    return success(serializeBigInt(task));
  } catch (err) {
    console.error("Crawl task detail error:", err);
    return error("获取爬取任务详情失败", 500);
  }
}
