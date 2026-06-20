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
    const size = Math.min(100, Math.max(1, parseInt(searchParams.get("size") || "20", 10)));
    const targetType = searchParams.get("target_type") || undefined;
    const violationReason = searchParams.get("violation_reason") || undefined;
    const dateFrom = searchParams.get("dateFrom") || undefined;
    const dateTo = searchParams.get("dateTo") || undefined;
    const operatorUserId = searchParams.get("operator_user_id") || undefined;
    const targetAuthorId = searchParams.get("target_author_id") || undefined;

    const where: Prisma.ViolationWhereInput = {};

    if (targetType) {
      where.target_type = targetType;
    }

    if (violationReason) {
      where.violation_reason = violationReason;
    }

    if (operatorUserId) {
      where.operator_user_id = BigInt(operatorUserId);
    }

    if (targetAuthorId) {
      where.target_author_id = targetAuthorId;
    }

    if (dateFrom || dateTo) {
      where.created_at = {};
      if (dateFrom) {
        where.created_at.gte = new Date(dateFrom);
      }
      if (dateTo) {
        where.created_at.lte = new Date(dateTo + "T23:59:59.999Z");
      }
    }

    const [violations, total] = await Promise.all([
      prisma.violation.findMany({
        where,
        orderBy: { created_at: "desc" },
        skip: (page - 1) * size,
        take: size,
        include: {
          feed: {
            select: {
              feed_id: true,
              title: true,
              content_snippet: true,
            },
          },
          comment: {
            select: {
              comment_id: true,
              content_text: true,
            },
          },
          reply: {
            select: {
              reply_id: true,
              content_text: true,
            },
          },
          user: {
            select: {
              id: true,
              username: true,
              display_name: true,
            },
          },
        },
      }),
      prisma.violation.count({ where }),
    ]);

    return success(serializeBigInt(violations), {
      meta: {
        page,
        size,
        total,
        totalPages: Math.ceil(total / size),
      },
    });
  } catch (err) {
    console.error("Violations list error:", err);
    return error("获取违规记录失败", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return unauthorized();

    const body = await req.json();
    const {
      targetType,
      targetId,
      violationReason,
      violationDetail,
      actionType,
      actionDetail,
      notification,
    } = body;

    if (!targetType || !targetId || !violationReason || !actionType) {
      return error("缺少必要参数：targetType, targetId, violationReason, actionType", 400);
    }

    // Resolve target author info based on target type
    let targetAuthor: string | null = null;
    let targetAuthorId: string | null = null;
    let targetFeedId: string | null = null;

    if (targetType === "feed") {
      const feed = await prisma.feed.findUnique({
        where: { feed_id: targetId },
        select: { author: true, author_id: true, feed_id: true },
      });
      if (feed) {
        targetAuthor = feed.author;
        targetAuthorId = feed.author_id;
        targetFeedId = feed.feed_id;
      }
    } else if (targetType === "comment") {
      const comment = await prisma.comment.findUnique({
        where: { comment_id: targetId },
        select: { author: true, author_id: true, feed_id: true },
      });
      if (comment) {
        targetAuthor = comment.author;
        targetAuthorId = comment.author_id;
        targetFeedId = comment.feed_id;
      }
    } else if (targetType === "reply") {
      const reply = await prisma.reply.findUnique({
        where: { reply_id: targetId },
        select: { author: true, author_id: true, feed_id: true },
      });
      if (reply) {
        targetAuthor = reply.author;
        targetAuthorId = reply.author_id;
        targetFeedId = reply.feed_id;
      }
    }

    const violation = await prisma.violation.create({
      data: {
        target_type: targetType,
        target_id: targetId,
        target_feed_id: targetFeedId,
        target_author: targetAuthor,
        target_author_id: targetAuthorId,
        violation_reason: violationReason,
        violation_detail: violationDetail || null,
        action_type: actionType,
        action_detail: actionDetail ? (actionDetail as Prisma.InputJsonValue) : undefined,
        notification_sent: notification?.enabled ? true : false,
        notification_type: notification?.enabled ? notification.type : null,
        notification_text: notification?.enabled ? notification.text : null,
        operator_user_id: BigInt(auth.userId),
      },
      include: {
        feed: {
          select: { feed_id: true, title: true },
        },
        comment: {
          select: { comment_id: true, content_text: true },
        },
        reply: {
          select: { reply_id: true, content_text: true },
        },
        user: {
          select: { id: true, username: true, display_name: true },
        },
      },
    });

    return success(serializeBigInt(violation));
  } catch (err) {
    console.error("Violation create error:", err);
    return error("创建违规记录失败", 500);
  }
}
