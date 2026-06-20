import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, success, error, serializeBigInt } from "@/lib/api-utils";

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return unauthorized();

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // Last 7 days range
    const sevenDaysAgo = new Date(todayStart);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);

    // Run all aggregate queries in parallel
    const [
      totalFeeds,
      totalComments,
      totalMembers,
      activeMembers,
      todayNewFeeds,
      todayNewComments,
      todayViolations,
      totalViolations,
      lastCrawlTask,
      last7DaysViolations,
      violationByReason,
      channelDistribution,
    ] = await Promise.all([
      // Basic counts
      prisma.feed.count({ where: { status: "active" } }),
      prisma.comment.count({ where: { status: "active" } }),
      prisma.member.count(),
      prisma.member.count({ where: { status: "active" } }),

      // Today's counts
      prisma.feed.count({
        where: { created_at: { gte: todayStart }, status: "active" },
      }),
      prisma.comment.count({
        where: { created_at: { gte: todayStart }, status: "active" },
      }),
      prisma.violation.count({
        where: { created_at: { gte: todayStart } },
      }),
      prisma.violation.count(),

      // Last crawl task
      prisma.crawlTask.findFirst({
        orderBy: { created_at: "desc" },
      }),

      // Last 7 days daily violation counts
      prisma.violation.findMany({
        where: { created_at: { gte: sevenDaysAgo } },
        select: { created_at: true },
        orderBy: { created_at: "asc" },
      }),

      // Violations grouped by reason
      prisma.violation.groupBy({
        by: ["violation_reason"],
        _count: { violation_reason: true },
      }),

      // Feed count per channel
      prisma.feed.groupBy({
        by: ["channel_name"],
        where: { status: "active" },
        _count: { channel_name: true },
      }),
    ]);

    // Build violation trend — fill in missing days with 0
    const violationTrend: { date: string; count: number }[] = [];
    const violationByDate = new Map<string, number>();

    for (const v of last7DaysViolations) {
      const dateKey = v.created_at.toISOString().slice(0, 10);
      violationByDate.set(dateKey, (violationByDate.get(dateKey) || 0) + 1);
    }

    for (let i = 0; i < 7; i++) {
      const d = new Date(sevenDaysAgo);
      d.setDate(d.getDate() + i);
      const dateKey = d.toISOString().slice(0, 10);
      violationTrend.push({
        date: dateKey,
        count: violationByDate.get(dateKey) || 0,
      });
    }

    return success({
      totalFeeds,
      totalComments,
      totalMembers,
      activeMembers,
      todayNewFeeds,
      todayNewComments,
      todayViolations,
      totalViolations,
      lastCrawlTask: lastCrawlTask ? serializeBigInt(lastCrawlTask) : null,
      violationTrend,
      violationByReason: violationByReason.map((v) => ({
        reason: v.violation_reason,
        count: v._count.violation_reason,
      })),
      channelDistribution: channelDistribution.map((c) => ({
        channel: c.channel_name || "未分类",
        count: c._count.channel_name,
      })),
    });
  } catch (err) {
    console.error("Dashboard error:", err);
    return error("获取仪表盘数据失败", 500);
  }
}
