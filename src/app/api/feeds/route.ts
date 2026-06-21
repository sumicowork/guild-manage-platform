import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, success, error, serializeBigInt, toCamelCase } from "@/lib/api-utils";
import type { Prisma } from "@/generated/prisma/client";

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return unauthorized();

    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") || "20", 10)));
    const search = searchParams.get("search")?.trim() || undefined;
    const channelId = searchParams.get("channelId")?.trim() || undefined;
    const status = searchParams.get("status")?.trim() || undefined;
    const sort = searchParams.get("sort") || "createdAt";
    const direction = searchParams.get("direction") || "desc";
    const dateFrom = searchParams.get("dateFrom") || undefined;
    const dateTo = searchParams.get("dateTo") || undefined;
    const authorId = searchParams.get("authorId")?.trim() || undefined;

    const where: Prisma.FeedWhereInput = {};

    // Status filter
    if (status) {
      where.status = status;
    }

    // Channel filter
    if (channelId) {
      where.channel_name = channelId;
    }

    // Author filter
    if (authorId) {
      where.author_id = authorId;
    }

    // Search filter
    if (search) {
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { author: { contains: search, mode: "insensitive" } },
        { feed_id: { contains: search, mode: "insensitive" } },
        { content: { contains: search, mode: "insensitive" } },
      ];
    }

    // Date range filter
    if (dateFrom || dateTo) {
      where.create_time = {};
      if (dateFrom) {
        where.create_time.gte = new Date(dateFrom);
      }
      if (dateTo) {
        where.create_time.lte = new Date(dateTo + "T23:59:59.999Z");
      }
    }

    // Sort
    let orderBy: Prisma.FeedOrderByWithRelationInput;
    switch (sort) {
      case "likeCount":
        orderBy = { prefer_count: direction === "asc" ? "asc" : "desc" };
        break;
      case "commentCount":
        orderBy = { comment_count: direction === "asc" ? "asc" : "desc" };
        break;
      case "createdAt":
      default:
        orderBy = { create_time: direction === "asc" ? "asc" : "desc" };
        break;
    }

    const [feeds, total] = await Promise.all([
      prisma.feed.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.feed.count({ where }),
    ]);

    const rawFeeds = serializeBigInt(feeds);
    const camelFeeds = toCamelCase(rawFeeds) as any[];
    const mapped = camelFeeds.map((f: any) => {
      const { preferCount, ...rest } = f;
      return {
        ...rest,
        likeCount: preferCount ?? 0,
        commentCount: f.commentCount ?? 0,
        createdAt: f.createTime ?? f.createdAt,
        channelId: '',
      };
    });
    return success(mapped, {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (err) {
    console.error("Feeds list error:", err);
    return error("获取帖子列表失败", 500);
  }
}
