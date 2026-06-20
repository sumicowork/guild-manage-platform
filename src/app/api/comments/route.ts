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
    const feedId = searchParams.get("feedId")?.trim() || undefined;
    const authorId = searchParams.get("authorId")?.trim() || undefined;

    const where: Prisma.CommentWhereInput = {};

    // Status filter
    where.status = status;

    // Feed filter
    if (feedId) {
      where.feed_id = feedId;
    }

    // Author filter
    if (authorId) {
      where.author_id = authorId;
    }

    // Search filter
    if (search) {
      where.OR = [
        { content_text: { contains: search, mode: "insensitive" } },
        { author: { contains: search, mode: "insensitive" } },
        { comment_id: { contains: search, mode: "insensitive" } },
      ];
    }

    const [comments, total] = await Promise.all([
      prisma.comment.findMany({
        where,
        orderBy: { create_time: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          feed: {
            select: {
              feed_id: true,
              title: true,
            },
          },
        },
      }),
      prisma.comment.count({ where }),
    ]);

    return success(serializeBigInt(comments), {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (err) {
    console.error("Comments list error:", err);
    return error("获取评论列表失败", 500);
  }
}
