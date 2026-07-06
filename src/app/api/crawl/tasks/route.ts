import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, success, error, serializeBigInt, toCamelCase } from "@/lib/api-utils";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return unauthorized();

    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") || "20", 10)));

    const [tasks, total] = await Promise.all([
      prisma.crawlTask.findMany({
        orderBy: { created_at: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.crawlTask.count(),
    ]);

    const rawTasks = serializeBigInt(tasks);
    const camelTasks = toCamelCase(rawTasks) as any[];
    const mapped = camelTasks.map((t: any) => ({
      ...t,
      type: t.taskType,
      trigger: t.triggeredBy,
      startedAt: t.startedAt,
      completedAt: t.finishedAt ?? null,
      errorMessage: t.errorLog ?? null,
    }));
    return success(mapped, { total });
  } catch (err) {
    console.error("Crawl tasks list error:", err);
    return error("获取爬取任务列表失败", 500);
  }
}
