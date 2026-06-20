import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, success, error, serializeBigInt } from "@/lib/api-utils";

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return unauthorized();

    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const size = Math.min(100, Math.max(1, parseInt(searchParams.get("size") || "20", 10)));

    const [tasks, total] = await Promise.all([
      prisma.crawlTask.findMany({
        orderBy: { created_at: "desc" },
        skip: (page - 1) * size,
        take: size,
      }),
      prisma.crawlTask.count(),
    ]);

    return success(serializeBigInt(tasks), {
      meta: {
        page,
        size,
        total,
        totalPages: Math.ceil(total / size),
      },
    });
  } catch (err) {
    console.error("Crawl tasks list error:", err);
    return error("获取爬取任务列表失败", 500);
  }
}
