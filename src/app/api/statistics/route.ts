import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, success, error } from "@/lib/api-utils";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    // TODO: restore auth check
    // const auth = await getAuthUser(req);
    // if (!auth) return unauthorized();

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAgo = new Date(today.getTime() - 7 * 86400000);
    const monthAgo = new Date(today.getTime() - 30 * 86400000);

    // Helper: distinct authors in a time range (feeds + comments union)
    const activeAuthors = async (since: Date) => {
      const [feedAuthors, commentAuthors] = await Promise.all([
        prisma.feed.findMany({
          where: { create_time: { gte: since } },
          select: { author_id: true },
          distinct: ["author_id"],
        }),
        prisma.comment.findMany({
          where: { create_time: { gte: since } },
          select: { author_id: true },
          distinct: ["author_id"],
        }),
      ]);
      return new Set([
        ...feedAuthors.map((f) => f.author_id),
        ...commentAuthors.map((c) => c.author_id),
      ]).size;
    };

    const [dau, wau, mau, totalMembers, activeMembers, leftMembers, newToday, newWeek, newMonth,
      totalFeeds, feedsToday, feedsWeek, totalComments, commentsToday, commentsWeek,
      dailyTrend, topAuthors, hourlyTrend
    ] = await Promise.all([
      activeAuthors(today),
      activeAuthors(weekAgo),
      activeAuthors(monthAgo),
      prisma.member.count(),
      prisma.member.count({ where: { status: "active" } }),
      prisma.member.count({ where: { status: "left" } }),
      prisma.member.count({ where: { join_time: { gte: today } } }),
      prisma.member.count({ where: { join_time: { gte: weekAgo } } }),
      prisma.member.count({ where: { join_time: { gte: monthAgo } } }),
      prisma.feed.count(),
      prisma.feed.count({ where: { create_time: { gte: today } } }),
      prisma.feed.count({ where: { create_time: { gte: weekAgo } } }),
      prisma.comment.count(),
      prisma.comment.count({ where: { create_time: { gte: today } } }),
      prisma.comment.count({ where: { create_time: { gte: weekAgo } } }),

      // Daily trend: last 30 days
      prisma.$queryRawUnsafe<Array<{ day: string; feeds: number; comments: number; authors: number }>>(`
        SELECT
          d::date as day,
          COALESCE(f.cnt, 0) as feeds,
          COALESCE(c.cnt, 0) as comments,
          COALESCE(a.cnt, 0) as authors
        FROM generate_series($1::date, $2::date, '1 day') d
        LEFT JOIN (
          SELECT create_time::date as day, COUNT(*) as cnt
          FROM feeds WHERE create_time >= $1 GROUP BY 1
        ) f ON f.day = d
        LEFT JOIN (
          SELECT create_time::date as day, COUNT(*) as cnt
          FROM comments WHERE create_time >= $1 GROUP BY 1
        ) c ON c.day = d
        LEFT JOIN (
          SELECT day, COUNT(DISTINCT author_id) as cnt FROM (
            SELECT create_time::date as day, author_id FROM feeds WHERE create_time >= $1
            UNION ALL
            SELECT create_time::date as day, author_id FROM comments WHERE create_time >= $1
          ) u GROUP BY 1
        ) a ON a.day = d
        ORDER BY d
      `, monthAgo, today),

      // Top authors by post count (last 30 days)
      prisma.feed.groupBy({
        by: ["author_id"],
        where: { create_time: { gte: monthAgo } },
        _count: { author_id: true },
        orderBy: { _count: { author_id: "desc" } },
        take: 10,
      }),

      // Hourly activity distribution (last 7 days)
      prisma.$queryRawUnsafe<Array<{ hour: number; feeds: number; comments: number }>>(`
        SELECT
          EXTRACT(HOUR FROM create_time)::int as hour,
          COALESCE(f.cnt, 0) as feeds,
          COALESCE(c.cnt, 0) as comments
        FROM generate_series(0, 23) h(hour)
        LEFT JOIN (
          SELECT EXTRACT(HOUR FROM create_time)::int as hour, COUNT(*) as cnt
          FROM feeds WHERE create_time >= $1 GROUP BY 1
        ) f ON f.hour = h.hour
        LEFT JOIN (
          SELECT EXTRACT(HOUR FROM create_time)::int as hour, COUNT(*) as cnt
          FROM comments WHERE create_time >= $1 GROUP BY 1
        ) c ON c.hour = h.hour
        ORDER BY h.hour
      `, weekAgo),
    ]);

    // Enrich top authors with nicknames
    const topAuthorIds = topAuthors.map((a) => a.author_id).filter(Boolean) as string[];
    const authorProfiles = await prisma.member.findMany({
      where: { tinyid: { in: topAuthorIds } },
      select: { tinyid: true, nickname: true },
    });
    const nicknameMap = new Map(authorProfiles.map((m) => [m.tinyid, m.nickname]));

    const result = {
      overview: {
        dau,
        wau,
        mau,
        stickyRatio: mau > 0 ? Math.round((dau / mau) * 100) : 0,
      },
      members: {
        total: totalMembers,
        active: activeMembers,
        left: leftMembers,
        newToday,
        newThisWeek: newWeek,
        newThisMonth: newMonth,
      },
      content: {
        totalFeeds,
        feedsToday,
        feedsThisWeek: feedsWeek,
        totalComments,
        commentsToday,
        commentsThisWeek: commentsWeek,
      },
      dailyTrend: dailyTrend.map((d) => ({
        date: d.day,
        feeds: Number(d.feeds),
        comments: Number(d.comments),
        authors: Number(d.authors),
      })),
      hourlyActivity: hourlyTrend.map((h) => ({
        hour: Number(h.hour),
        feeds: Number(h.feeds),
        comments: Number(h.comments),
      })),
      topAuthors: topAuthors.map((a) => ({
        tinyid: a.author_id || '',
        nickname: nicknameMap.get(a.author_id || '') || (a.author_id || ''),
        postCount: a._count.author_id,
      })),
    };

    return success(result);
  } catch (err) {
    console.error("Statistics error:", err);
    return error("获取统计数据失败", 500);
  }
}
