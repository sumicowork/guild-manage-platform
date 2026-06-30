import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, success, error, serializeBigInt, toCamelCase, parsePage, parsePageSize } from "@/lib/api-utils";
import type { Prisma } from "@/generated/prisma/client";

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return unauthorized();

    const { searchParams } = new URL(req.url);
    const page = parsePage(searchParams.get("page"), 1);
    const pageSize = parsePageSize(searchParams.get("pageSize"), 20);
    const search = searchParams.get("search")?.trim() || undefined;
    const status = searchParams.get("status")?.trim() || undefined;
    const tag = searchParams.get("tag")?.trim() || undefined;
    const role = searchParams.get("role")?.trim() || undefined;
    const sort = searchParams.get("sort") || "createdAt";
    const direction = searchParams.get("direction") || "desc";

    const where: Prisma.MemberWhereInput = {};

    // Status filter (no default — empty means all)
    if (status) {
      where.status = status;
    }

    // Role filter
    if (role) {
      where.role = role;
    }

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

    // For DB-level sortable fields, use Prisma orderBy directly.
    // For computed fields (feedCount, commentCount), we sort in JS after enrichment.
    const isComputedSort = sort === "feedCount" || sort === "commentCount";

    let orderBy: Prisma.MemberOrderByWithRelationInput;
    if (!isComputedSort) {
      switch (sort) {
        case "joinedAt":
          orderBy = { join_time: direction === "asc" ? "asc" : "desc" };
          break;
        case "createdAt":
        default:
          orderBy = { created_at: direction === "asc" ? "asc" : "desc" };
          break;
      }
    } else {
      // Default ordering for computed sorts — we'll sort in JS
      orderBy = { created_at: "desc" };
    }

    // For computed sorts we need all matching records; for DB sorts, paginate normally
    const total = await prisma.member.count({ where });

    let members;
    if (isComputedSort) {
      // Fetch all matching members (capped at 5000 to prevent OOM)
      members = await prisma.member.findMany({
        where,
        orderBy,
        take: 5000,
        include: {
          tags: true,
          _count: { select: { violations: true } },
        },
      });
    } else {
      members = await prisma.member.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          tags: true,
          _count: { select: { violations: true } },
        },
      });
    }

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

    // In-memory sort for computed fields
    if (isComputedSort) {
      const dir = direction === "asc" ? 1 : -1;
      enriched.sort((a, b) => {
        const aVal = sort === "feedCount" ? a.postCount : a.commentCount;
        const bVal = sort === "feedCount" ? b.postCount : b.commentCount;
        return (aVal - bVal) * dir;
      });
    }

    // Manual pagination for computed sorts
    const paginated = isComputedSort
      ? enriched.slice((page - 1) * pageSize, page * pageSize)
      : enriched;

    const rawEnriched = serializeBigInt(paginated);
    const camelEnriched = toCamelCase(rawEnriched) as any[];
    const mapped = camelEnriched.map((m: any) => ({
      ...m,
      joinedAt: m.joinTime ?? null,
      feedCount: m.postCount ?? 0,
      likeCount: 0,
      tags: (m.tags || []).map((t: any) => t.tag),
    }));

    return success(mapped, {
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
