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
    const channelId = searchParams.get("channelId")?.trim() || undefined;
    const status = searchParams.get("status")?.trim() || undefined;
    const sort = searchParams.get("sort") || "createdAt";
    const direction = searchParams.get("direction") || "desc";
    const dateFrom = searchParams.get("dateFrom") || undefined;
    const dateTo = searchParams.get("dateTo") || undefined;
    const authorId = searchParams.get("authorId")?.trim() || undefined;

    const where: Prisma.FeedWhereInput = {};
    const andConditions: Prisma.FeedWhereInput[] = [];

    // Status filter
    if (status) {
      where.status = status;
    }

    // Author filter
    if (authorId) {
      where.author_id = authorId;
    }

    // Channel filter: match by channel_id or channel_name (some channels only have name)
    if (channelId) {
      andConditions.push({
        OR: [
          { channel_id: channelId },
          { channel_name: channelId },
        ],
      });
    }

    // Search filter
    let matchedCommentsByFeed: Map<string, any[]> = new Map();

    if (search) {
      const searchOr: Prisma.FeedWhereInput[] = [
        { title: { contains: search, mode: "insensitive" } },
        { author: { contains: search, mode: "insensitive" } },
        { feed_id: { contains: search, mode: "insensitive" } },
        { content: { contains: search, mode: "insensitive" } },
      ];

      // Search comment content_text too
      const matchedComments = await prisma.comment.findMany({
        where: {
          content_text: { contains: search, mode: "insensitive" },
          status: "active",
        },
        select: {
          feed_id: true,
          comment_id: true,
          author: true,
          content_text: true,
          create_time: true,
        },
        take: 500,
      });

      for (const c of matchedComments) {
        const key = c.feed_id;
        if (!matchedCommentsByFeed.has(key)) {
          matchedCommentsByFeed.set(key, []);
        }
        matchedCommentsByFeed.get(key)!.push({
          commentId: c.comment_id,
          author: c.author,
          contentText: c.content_text,
          createTime: c.create_time,
        });
      }

      // Include feeds whose comments matched, even if the post itself didn't match
      const commentFeedIds = [...matchedCommentsByFeed.keys()];
      if (commentFeedIds.length > 0) {
        searchOr.push({ feed_id: { in: commentFeedIds } });
      }

      andConditions.push({ OR: searchOr });
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

    // Combine AND conditions with simple filters
    if (andConditions.length > 0) {
      where.AND = andConditions;
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
      const { preferCount, feedId, ...rest } = f;
      const matchedComments = matchedCommentsByFeed.get(feedId) || [];
      return {
        ...rest,
        feedId,
        likeCount: preferCount ?? 0,
        commentCount: f.commentCount ?? 0,
        createdAt: f.createTime ?? f.createdAt,
        channelId: f.channelId ?? '',
        matchedComments,
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
