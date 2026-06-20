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
    const targetType = searchParams.get("target_type") || undefined;
    const violationReason = searchParams.get("reason") || undefined;
    const actionType = searchParams.get("actionType") || undefined;
    const dateFrom = searchParams.get("dateFrom") || undefined;
    const dateTo = searchParams.get("dateTo") || undefined;
    const operator = searchParams.get("operator")?.trim() || undefined;
    const targetAuthorId = searchParams.get("target_author_id") || undefined;

    const where: Prisma.ViolationWhereInput = {};

    if (targetType) {
      where.target_type = targetType;
    }

    if (violationReason) {
      where.violation_reason = violationReason;
    }

    if (actionType) {
      where.action_type = actionType;
    }

    if (operator) {
      const opUser = await prisma.platformUser.findFirst({
        where: { username: operator },
        select: { id: true },
      });
      if (opUser) {
        where.operator_user_id = opUser.id;
      }
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
        skip: (page - 1) * pageSize,
        take: pageSize,
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

    const rawViolations = serializeBigInt(violations);
    const camelViolations = toCamelCase(rawViolations) as any[];
    const mapped = camelViolations.map((v: any) => ({
      ...v,
      reason: v.violationReason ?? '',
      operator: v.user?.username ?? v.user?.displayName ?? '',
      identityName: v.operatorAdminName ?? '',
      notified: v.notificationSent ?? false,
    }));
    return success(mapped, {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
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
      reasonId,
      violationDetail,
      detail,
      actionType,
      actionDetail,
      targetChannel,
      mute,
      notification,
      targetAuthorId,
      targetFeedId,
    } = body;

    // Resolve violation reason: accept either reason name (violationReason) or reasonId
    let resolvedReason = violationReason;
    if (!resolvedReason && reasonId) {
      const reason = await prisma.violationReason.findUnique({
        where: { id: Number(reasonId) },
      });
      if (reason) {
        resolvedReason = reason.name;
      }
    }

    if (!targetType || !targetId || !resolvedReason || !actionType) {
      return error("缺少必要参数：targetType, targetId, violationReason/reasonId, actionType", 400);
    }

    // Resolve target author info based on target type
    let resolvedTargetAuthor: string | null = targetAuthorId ? null : null;
    let resolvedTargetAuthorId: string | null = targetAuthorId || null;
    let resolvedTargetFeedId: string | null = targetFeedId || null;

    if (targetType === "feed") {
      const feed = await prisma.feed.findUnique({
        where: { feed_id: targetId },
        select: { author: true, author_id: true, feed_id: true },
      });
      if (feed) {
        resolvedTargetAuthor = feed.author;
        resolvedTargetAuthorId = feed.author_id;
        resolvedTargetFeedId = feed.feed_id;
      }
    } else if (targetType === "comment") {
      const comment = await prisma.comment.findUnique({
        where: { comment_id: targetId },
        select: { author: true, author_id: true, feed_id: true },
      });
      if (comment) {
        resolvedTargetAuthor = comment.author;
        resolvedTargetAuthorId = comment.author_id;
        resolvedTargetFeedId = comment.feed_id;
      }
    } else if (targetType === "reply") {
      const reply = await prisma.reply.findUnique({
        where: { reply_id: targetId },
        select: { author: true, author_id: true, feed_id: true },
      });
      if (reply) {
        resolvedTargetAuthor = reply.author;
        resolvedTargetAuthorId = reply.author_id;
        resolvedTargetFeedId = reply.feed_id;
      }
    }

    // Build action_detail from client fields
    const resolvedActionDetail: Record<string, unknown> = {};
    if (targetChannel) resolvedActionDetail.movedToChannel = targetChannel;
    if (mute?.duration) resolvedActionDetail.muteDurationHours = mute.duration;
    if (actionDetail) Object.assign(resolvedActionDetail, actionDetail);

    const violation = await prisma.violation.create({
      data: {
        target_type: targetType,
        target_id: targetId,
        target_feed_id: resolvedTargetFeedId,
        target_author: resolvedTargetAuthor,
        target_author_id: resolvedTargetAuthorId,
        violation_reason: resolvedReason,
        violation_detail: (detail || violationDetail) || null,
        action_type: actionType,
        action_detail: Object.keys(resolvedActionDetail).length > 0
          ? (resolvedActionDetail as Prisma.InputJsonValue)
          : undefined,
        notification_sent: notification?.enabled || notification?.type ? true : false,
        notification_type: notification?.type || null,
        notification_text: notification?.content || notification?.text || null,
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
