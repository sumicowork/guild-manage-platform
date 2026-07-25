import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, success, error } from "@/lib/api-utils";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return unauthorized();

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAgo = new Date(today.getTime() - 7 * 86400000);
    const monthAgo = new Date(today.getTime() - 30 * 86400000);

    // ---- Helpers ----

    const activeAuthors = async (since: Date) => {
      const [feedAuthors, commentAuthors] = await Promise.all([
        prisma.feed.findMany({ where: { create_time: { gte: since } }, select: { author_id: true }, distinct: ["author_id"] }),
        prisma.comment.findMany({ where: { create_time: { gte: since } }, select: { author_id: true }, distinct: ["author_id"] }),
      ]);
      return new Set([...feedAuthors.map((f) => f.author_id), ...commentAuthors.map((c) => c.author_id)]).size;
    };

    /** Fetch feeds + comments for the period, group by day in JS (avoids $queryRaw 500). */
    const buildDailyTrend = async () => {
      const [feeds, comments] = await Promise.all([
        prisma.feed.findMany({ where: { create_time: { gte: monthAgo } }, select: { create_time: true, author_id: true } }),
        prisma.comment.findMany({ where: { create_time: { gte: monthAgo } }, select: { create_time: true, author_id: true } }),
      ]);

      const feedsByDay = new Map<string, number>();
      const commentsByDay = new Map<string, number>();
      const authorsByDay = new Map<string, Set<string>>();

      for (const f of feeds) {
        const d = f.create_time!.toISOString().slice(0, 10);
        feedsByDay.set(d, (feedsByDay.get(d) || 0) + 1);
        if (!authorsByDay.has(d)) authorsByDay.set(d, new Set());
        authorsByDay.get(d)!.add(f.author_id!);
      }
      for (const c of comments) {
        const d = c.create_time!.toISOString().slice(0, 10);
        commentsByDay.set(d, (commentsByDay.get(d) || 0) + 1);
        if (!authorsByDay.has(d)) authorsByDay.set(d, new Set());
        authorsByDay.get(d)!.add(c.author_id!);
      }

      const result: Array<{ date: string; feeds: number; comments: number; authors: number }> = [];
      for (let i = 0; i < 30; i++) {
        const d = new Date(today.getTime() - (29 - i) * 86400000).toISOString().slice(0, 10);
        result.push({
          date: d,
          feeds: feedsByDay.get(d) || 0,
          comments: commentsByDay.get(d) || 0,
          authors: authorsByDay.get(d)?.size || 0,
        });
      }
      return result;
    };

    /** Fetch feeds + comments for the week, group by hour. */
    const buildHourlyActivity = async () => {
      const [feeds, comments] = await Promise.all([
        prisma.feed.findMany({ where: { create_time: { gte: weekAgo } }, select: { create_time: true } }),
        prisma.comment.findMany({ where: { create_time: { gte: weekAgo } }, select: { create_time: true } }),
      ]);

      const feedsByHour = new Array(24).fill(0);
      const commentsByHour = new Array(24).fill(0);
      for (const f of feeds) feedsByHour[f.create_time!.getHours()]++;
      for (const c of comments) commentsByHour[c.create_time!.getHours()]++;

      return Array.from({ length: 24 }, (_, h) => ({
        hour: h,
        feeds: feedsByHour[h],
        comments: commentsByHour[h],
      }));
    };

    const [dau, wau, mau, totalMembers, activeMembers, leftMembers, newToday, newWeek, newMonth,
      totalFeeds, feedsToday, feedsWeek, totalComments, commentsToday, commentsWeek,
      topAuthors, dailyTrend, hourlyActivity,
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

      // Top authors by post count (last 30 days)
      prisma.feed.groupBy({
        by: ["author_id"],
        where: { create_time: { gte: monthAgo } },
        _count: { author_id: true },
        orderBy: { _count: { author_id: "desc" } },
        take: 10,
      }),
      buildDailyTrend(),
      buildHourlyActivity(),
    ]);

    const topAuthorIds = topAuthors.map((a) => a.author_id).filter(Boolean) as string[];
    const authorProfiles = await prisma.member.findMany({
      where: { tinyid: { in: topAuthorIds } },
      select: { tinyid: true, nickname: true },
    });
    const nicknameMap = new Map(authorProfiles.map((m) => [m.tinyid, m.nickname]));

    console.log("[stats-debug] dailyTrend length:", dailyTrend.length, "hourlyActivity length:", hourlyActivity.length, "dailyTrend[0]:", dailyTrend[0]);

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
