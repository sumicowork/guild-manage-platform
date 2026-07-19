import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, success, error, serializeBigInt, toCamelCase } from "@/lib/api-utils";

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return unauthorized();

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // Last 7 days range for violation trend
    const sevenDaysAgo = new Date(todayStart);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);

    // Last 30 days range for feed/comment trends
    const thirtyDaysAgo = new Date(todayStart);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);

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
      feedsByChannel,
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

      // Last 7 days daily violation counts (capped for safety)
      prisma.violation.findMany({
        where: { created_at: { gte: sevenDaysAgo } },
        select: { created_at: true },
        orderBy: { created_at: "asc" },
        take: 5000,
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

    // ── Additional queries using real post time (create_time), not crawler insert time ──

    // 30-day per-day feed counts (by post time, Beijing timezone)
    const feedTrendRaw = await prisma.$queryRawUnsafe<
      Array<{ dt: string; n: bigint }>
    >(
      `SELECT (create_time AT TIME ZONE 'Asia/Shanghai')::date::text as dt, COUNT(*)::bigint as n
       FROM feeds
       WHERE create_time >= (DATE_TRUNC('day', NOW() AT TIME ZONE 'Asia/Shanghai') - INTERVAL '29 days')
         AT TIME ZONE 'Asia/Shanghai'
         AND create_time IS NOT NULL
       GROUP BY dt ORDER BY dt`,
    );

    // 30-day per-day comment counts (by post time, Beijing timezone)
    const commentTrendRaw = await prisma.$queryRawUnsafe<
      Array<{ dt: string; n: bigint }>
    >(
      `SELECT (create_time AT TIME ZONE 'Asia/Shanghai')::date::text as dt, COUNT(*)::bigint as n
       FROM comments
       WHERE create_time >= (DATE_TRUNC('day', NOW() AT TIME ZONE 'Asia/Shanghai') - INTERVAL '29 days')
         AT TIME ZONE 'Asia/Shanghai'
         AND create_time IS NOT NULL
       GROUP BY dt ORDER BY dt`,
    );

    // Hourly activity — last 24h feeds by post time in Beijing timezone
    const hourlyRaw = await prisma.$queryRawUnsafe<
      Array<{ hr: number; n: bigint }>
    >(
      `SELECT EXTRACT(HOUR FROM create_time AT TIME ZONE 'Asia/Shanghai')::int as hr, COUNT(*)::bigint as n
       FROM feeds
       WHERE create_time >= (NOW() AT TIME ZONE 'Asia/Shanghai' - INTERVAL '24 hours')
         AT TIME ZONE 'Asia/Shanghai'
         AND create_time IS NOT NULL
       GROUP BY hr ORDER BY hr`,
    );

    // Top 10 feed + comment authors (active status only)
    const topFeedAuthorsRaw = await prisma.$queryRawUnsafe<
      Array<{ author: string; n: bigint }>
    >(
      `SELECT author, COUNT(*)::bigint as n FROM feeds WHERE status = 'active' AND author IS NOT NULL
       GROUP BY author ORDER BY n DESC LIMIT 10`,
    );

    const topCommentAuthorsRaw = await prisma.$queryRawUnsafe<
      Array<{ author: string; n: bigint }>
    >(
      `SELECT author, COUNT(*)::bigint as n FROM comments WHERE status = 'active' AND author IS NOT NULL
       GROUP BY author ORDER BY n DESC LIMIT 10`,
    );

    console.log(`[Dashboard] feeds=${totalFeeds} comments=${totalComments} members=${totalMembers}`);

    // ── Build violation trend ──
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
      violationTrend.push({ date: dateKey, count: violationByDate.get(dateKey) || 0 });
    }

    // ── Build feed & comment 30-day trends (fill gaps with 0) ──
    const feedTrendMap = new Map<string, number>(
      feedTrendRaw.map((r) => [String(r.dt), Number(r.n)])
    );
    const commentTrendMap = new Map<string, number>(
      commentTrendRaw.map((r) => [String(r.dt), Number(r.n)])
    );

    const contentTrend: { date: string; feeds: number; comments: number }[] = [];
    for (let i = 0; i < 30; i++) {
      const d = new Date(thirtyDaysAgo);
      d.setDate(d.getDate() + i);
      const dateKey = d.toISOString().slice(0, 10);
      contentTrend.push({
        date: dateKey,
        feeds: feedTrendMap.get(dateKey) || 0,
        comments: commentTrendMap.get(dateKey) || 0,
      });
    }

    // ── Build hourly activity (fill 0–23 with 0) ──
    const hourlyMap = new Map<number, number>(
      hourlyRaw.map((r) => [Number(r.hr), Number(r.n)])
    );
    const hourlyActivity: { hour: string; count: number }[] = [];
    for (let h = 0; h < 24; h++) {
      hourlyActivity.push({
        hour: `${String(h).padStart(2, "0")}:00`,
        count: hourlyMap.get(h) || 0,
      });
    }

    // ── Top authors ──
    const topFeedAuthors = topFeedAuthorsRaw.map((r) => ({
      author: r.author,
      count: Number(r.n),
    }));
    const topCommentAuthors = topCommentAuthorsRaw.map((r) => ({
      author: r.author,
      count: Number(r.n),
    }));

    // ── Build channel distribution ──
    const channelDistribution = feedsByChannel.map((c) => ({
      channel: c.channel_name || "未分类",
      feeds: c._count.channel_name,
      comments: 0,
    }));
    const commentsByChannel = await prisma.$queryRawUnsafe<
      Array<{ channel_name: string; cnt: bigint }>
    >(
      `SELECT COALESCE(f.channel_name, '未分类') as channel_name, COUNT(*) as cnt
       FROM comments c JOIN feeds f ON c.feed_id = f.feed_id
       WHERE c.status = 'active' AND f.status = 'active'
       GROUP BY f.channel_name`
    );
    const commentMap = new Map<string, number>(
      commentsByChannel.map((r) => [r.channel_name, Number(r.cnt)])
    );
    for (const ch of channelDistribution) {
      ch.comments = commentMap.get(ch.channel) || 0;
    }

    return success({
      stats: {
        totalFeeds,
        totalComments,
        totalMembers,
        activeMembers,
        todayNewFeeds,
        todayNewComments,
        todayViolations,
        totalViolations,
      },
      lastCrawlTask: lastCrawlTask
        ? (() => {
            const raw = toCamelCase(serializeBigInt(lastCrawlTask)) as any;
            return {
              ...raw,
              type: raw.taskType,
              startedAt: raw.startedAt,
              completedAt: raw.finishedAt ?? null,
            };
          })()
        : null,
      violationTrend,
      violationReasons: violationByReason.map((v) => ({
        reason: v.violation_reason,
        count: v._count.violation_reason,
      })),
      channelDistribution,
      contentTrend,
      hourlyActivity,
      topFeedAuthors,
      topCommentAuthors,
    });
  } catch (err) {
    console.error("Dashboard error:", err);
    return error("获取仪表盘数据失败", 500);
  }
}
