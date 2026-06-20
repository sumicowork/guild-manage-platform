import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, success, error, serializeBigInt } from "@/lib/api-utils";
import type { Prisma } from "@/generated/prisma/client";

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return unauthorized();

    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") || "20", 10)));
    const search = searchParams.get("search")?.trim() || undefined;
    const status = searchParams.get("status") || "active";
    const tag = searchParams.get("tag")?.trim() || undefined;

    const where: Prisma.MemberWhereInput = {};

    // Status filter
    where.status = status;

    // Tag filter
    if (tag) {
      where.tags = {
        some: { tag },
      };
    }

    // Search filter
    if (search) {
      where.OR = [
        { nickname: { contains: search, mode: "insensitive" } },
        { tinyid: { contains: search, mode: "insensitive" } },
        { global_nickname: { contains: search, mode: "insensitive" } },
      ];
    }

    const [members, total] = await Promise.all([
      prisma.member.findMany({
        where,
        orderBy: { created_at: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          tags: true,
          _count: {
            select: {
              violations: true,
            },
          },
        },
      }),
      prisma.member.count({ where }),
    ]);

    // Enrich members with post/comment counts
    const memberIds = members.map((m) => m.tinyid);

    const [postCounts, commentCounts] = await Promise.all([
      prisma.feed.groupBy({
        by: ["author_id"],
        where: { author_id: { in: memberIds } },
        _count: { author_id: true },
      }),
      prisma.comment.groupBy({
        by: ["author_id"],
        where: { author_id: { in: memberIds } },
        _count: { author_id: true },
      }),
    ]);

    const postCountMap = new Map(
      postCounts.map((p) => [p.author_id, p._count.author_id])
    );
    const commentCountMap = new Map(
      commentCounts.map((c) => [c.author_id, c._count.author_id])
    );

    const enriched = members.map((m) => ({
      ...m,
      postCount: postCountMap.get(m.tinyid) || 0,
      commentCount: commentCountMap.get(m.tinyid) || 0,
    }));

    return success(serializeBigInt(enriched), {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (err) {
    console.error("Members list error:", err);
    return error("获取成员列表失败", 500);
  }
}
