import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, success, error } from "@/lib/api-utils";
import { Pool } from "pg";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const auth = await getAuthUser(req);
    if (!auth) return unauthorized();

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAgo = new Date(today.getTime() - 7 * 86400000);
    const monthAgo = new Date(today.getTime() - 30 * 86400000);

    /** Format Date as YYYY-MM-DD in local timezone (avoids pg Date→UTC conversion issues). */
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const todayStr = fmt(today);
    const monthAgoStr = fmt(monthAgo);
    const weekAgoStr = fmt(weekAgo);

    const activeAuthors = async (since: Date) => {
      const [feedAuthors, commentAuthors] = await Promise.all([
        prisma.feed.findMany({ where: { create_time: { gte: since } }, select: { author_id: true }, distinct: ["author_id"] }),
        prisma.comment.findMany({ where: { create_time: { gte: since } }, select: { author_id: true }, distinct: ["author_id"] }),
      ]);
      return new Set([...feedAuthors.map((f) => f.author_id), ...commentAuthors.map((c) => c.author_id)]).size;
    };

    console.log("[stats-debug] pool.DATABASE_URL exists:", !!process.env.DATABASE_URL);
    const dailyTrendQuery = pool.query(
      `SELECT d::date as day, COALESCE(f.cnt,0)::int as feeds, COALESCE(c.cnt,0)::int as comments,
        COALESCE(a.cnt,0)::int as authors
      FROM generate_series($1::date, $2::date, '1 day') d
      LEFT JOIN (SELECT create_time::date as day, COUNT(*) as cnt FROM feeds WHERE create_time >= $1 GROUP BY 1) f ON f.day = d
      LEFT JOIN (SELECT create_time::date as day, COUNT(*) as cnt FROM comments WHERE create_time >= $1 GROUP BY 1) c ON c.day = d
      LEFT JOIN (
        SELECT day, COUNT(DISTINCT author_id) as cnt FROM (
          SELECT create_time::date as day, author_id FROM feeds WHERE create_time >= $3
          UNION ALL
          SELECT create_time::date as day, author_id FROM comments WHERE create_time >= $3
        ) u GROUP BY 1
      ) a ON a.day = d
      ORDER BY d`,
      [monthAgoStr, todayStr, monthAgoStr]
    );

    const hourlyActivityQuery = pool.query(
      `SELECT EXTRACT(HOUR FROM create_time)::int as hour,
        COUNT(*) FILTER (WHERE source = 'feed')::int as feeds,
        COUNT(*) FILTER (WHERE source = 'comment')::int as comments
      FROM (
        SELECT create_time, 'feed' as source FROM feeds WHERE create_time >= $1
        UNION ALL
        SELECT create_time, 'comment' as source FROM comments WHERE create_time >= $1
      ) u
      GROUP BY 1 ORDER BY 1`,
      [weekAgoStr]
    );

    const [dau, wau, mau, totalMembers, activeMembers, leftMembers, newToday, newWeek, newMonth,
      totalFeeds, feedsToday, feedsWeek, totalComments, commentsToday, commentsWeek,
      topAuthors, dailyTrendResult, hourlyActivityResult,
    ] = await Promise.all([
      activeAuthors(today), activeAuthors(weekAgo), activeAuthors(monthAgo),
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
      prisma.feed.groupBy({
        by: ["author_id"],
        where: { create_time: { gte: monthAgo } },
        _count: { author_id: true },
        orderBy: { _count: { author_id: "desc" } },
        take: 10,
      }),
      dailyTrendQuery.then(r => { console.log("[stats-debug] dailyTrend rows:", r.rows.length, r.rows[0]); return r; }).catch(e => { console.error("[stats-debug] dailyTrend err:", e.message); return { rows: [] }; }),
      hourlyActivityQuery.then(r => { console.log("[stats-debug] hourlyActivity rows:", r.rows.length); return r; }).catch(e => { console.error("[stats-debug] hourlyActivity err:", e.message); return { rows: [] }; }),
    ]);

    const topAuthorIds = topAuthors.map((a) => a.author_id).filter(Boolean) as string[];
    const authorProfiles = await prisma.member.findMany({
      where: { tinyid: { in: topAuthorIds } },
      select: { tinyid: true, nickname: true },
    });
    const nicknameMap = new Map(authorProfiles.map((m) => [m.tinyid, m.nickname]));

    const dailyTrend = dailyTrendResult.rows.map((r) => ({
      date: typeof r.day === "string" ? r.day.slice(0, 10) : r.day,
      feeds: Number(r.feeds),
      comments: Number(r.comments),
      authors: Number(r.authors),
    }));

    const hourlyActivity = Array.from({ length: 24 }, (_, h) => {
      const row = hourlyActivityResult.rows.find((r) => Number(r.hour) === h);
      return { hour: h, feeds: row ? Number(row.feeds) : 0, comments: row ? Number(row.comments) : 0 };
    });

    return success({
      overview: { dau, wau, mau, stickyRatio: mau > 0 ? Math.round((dau / mau) * 100) : 0 },
      members: { total: totalMembers, active: activeMembers, left: leftMembers, newToday, newThisWeek: newWeek, newThisMonth: newMonth },
      content: { totalFeeds, feedsToday, feedsThisWeek: feedsWeek, totalComments, commentsToday, commentsThisWeek: commentsWeek },
      dailyTrend,
      hourlyActivity,
      topAuthors: topAuthors.map((a) => ({
        tinyid: a.author_id || '',
        nickname: nicknameMap.get(a.author_id || '') || (a.author_id || ''),
        postCount: a._count.author_id,
      })),
    });
  } catch (err) {
    console.error("Statistics error:", err);
    return error("获取统计数据失败", 500);
  }
}
