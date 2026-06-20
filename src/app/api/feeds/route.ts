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
    const channel = searchParams.get("channel")?.trim() || undefined;
    const status = searchParams.get("status") || "active";
    const sortBy = searchParams.get("sortBy") || "time";
    const sortOrder = searchParams.get("sortOrder") || "desc";
    const dateFrom = searchParams.get("dateFrom") || undefined;
    const dateTo = searchParams.get("dateTo") || undefined;
    const authorId = searchParams.get("authorId")?.trim() || undefined;

    const where: Prisma.FeedWhereInput = {};

    // Status filter
    if (status === "deleted") {
      where.status = "deleted";
    } else {
      where.status = "active";
    }

    // Channel filter
    if (channel) {
      where.channel_name = channel;
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
    switch (sortBy) {
      case "likes":
        orderBy = { prefer_count: sortOrder === "asc" ? "asc" : "desc" };
        break;
      case "comments":
        orderBy = { comment_count: sortOrder === "asc" ? "asc" : "desc" };
        break;
      case "time":
      default:
        orderBy = { create_time: sortOrder === "asc" ? "asc" : "desc" };
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

    return success(serializeBigInt(feeds), {
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
