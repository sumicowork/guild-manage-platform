import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, success, error, serializeBigInt, toCamelCase } from "@/lib/api-utils";
import type { Prisma } from "@/generated/prisma/client";
import { movePost, deletePost, deleteComment, postComment } from "@/lib/cli/feed";
import { muteUser, kickUser, sendDM } from "@/lib/cli/member";

const GUILD_ID = process.env.GUILD_ID || "82203161765285899";

/** Resolve notification template variables */
function resolveTemplate(
  template: string,
  vars: { nickname: string; title: string; link: string; reason: string }
): string {
  return template
    .replace(/\{用户昵称\}/g, vars.nickname)
    .replace(/\{帖子标题\}/g, vars.title)
    .replace(/\{帖子链接\}/g, vars.link)
    .replace(/\{违规原因\}/g, vars.reason);
}

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
      notificationText,
      adminIdentityId,
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

    // Always resolve target info from DB for CLI execution
    let resolvedTargetAuthor: string | null = targetAuthorId ? null : null;
    let resolvedTargetAuthorId: string | null = targetAuthorId || null;
    let resolvedTargetFeedId: string | null = targetFeedId || null;
    let targetTitle: string = "";
    let targetShareUrl: string = "";
    let targetCommentId: string | null = null;
    let targetChannelName: string | null = null;
    let targetCreateTimeRaw: bigint | null = null;
    let targetCommentAuthorId: string | null = null;

    if (targetType === "feed") {
      const feed = await prisma.feed.findUnique({
        where: { feed_id: targetId },
        select: { author: true, author_id: true, feed_id: true, title: true, share_url: true, channel_name: true, create_time_raw: true },
      });
      if (feed) {
        resolvedTargetAuthor = feed.author;
        resolvedTargetAuthorId = feed.author_id;
        resolvedTargetFeedId = feed.feed_id;
        targetTitle = feed.title || "";
        targetShareUrl = feed.share_url || "";
        targetChannelName = feed.channel_name;
        targetCreateTimeRaw = feed.create_time_raw;
      }
    } else if (targetType === "comment") {
      const comment = await prisma.comment.findUnique({
        where: { comment_id: targetId },
        include: {
          feed: { select: { feed_id: true, title: true, share_url: true, channel_name: true, create_time_raw: true } },
        },
      });
      if (comment) {
        resolvedTargetAuthor = comment.author;
        resolvedTargetAuthorId = comment.author_id;
        resolvedTargetFeedId = comment.feed_id;
        targetCommentId = comment.comment_id;
        targetCommentAuthorId = comment.author_id;
        targetTitle = comment.feed?.title || "";
        targetShareUrl = comment.feed?.share_url || "";
        targetChannelName = comment.feed?.channel_name;
        targetCreateTimeRaw = comment.feed?.create_time_raw;
      }
    } else if (targetType === "reply") {
      const reply = await prisma.reply.findUnique({
        where: { reply_id: targetId },
        include: {
          comment: true,
          feed: { select: { feed_id: true, title: true, share_url: true, channel_name: true, create_time_raw: true } },
        },
      });
      if (reply) {
        resolvedTargetAuthor = reply.author;
        resolvedTargetAuthorId = reply.author_id;
        resolvedTargetFeedId = reply.feed_id;
        targetCommentId = reply.comment_id;
        targetTitle = reply.feed?.title || "";
        targetShareUrl = reply.feed?.share_url || "";
        targetChannelName = reply.feed?.channel_name;
        targetCreateTimeRaw = reply.feed?.create_time_raw;
      }
    }

    // Build action_detail from client fields
    const resolvedActionDetail: Record<string, unknown> = {};
    if (targetChannel) resolvedActionDetail.movedToChannel = targetChannel;
    if (mute?.duration) resolvedActionDetail.muteDurationHours = mute.duration;
    if (actionDetail) Object.assign(resolvedActionDetail, actionDetail);

    // Create the violation record
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
        notification_sent: false,
        notification_type: notification?.type || null,
        notification_text: notification?.content || notificationText || notification?.text || null,
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

    // ─── Execute CLI actions (move/delete/mute) ───────────────────────
    const cliResults: string[] = [];
    const isMove = actionType.includes("move");
    const isDelete = actionType.includes("delete");
    const isMute = actionType.includes("mute");
    const feedCreateTimeStr = targetCreateTimeRaw ? String(targetCreateTimeRaw) : "";

    if (isMove && targetType === "feed" && resolvedTargetFeedId && targetChannel) {
      const ok = await movePost(GUILD_ID, resolvedTargetFeedId, targetChannel, targetChannelName || "", adminIdentityId);
      cliResults.push(ok ? "移帖成功" : "移帖失败");
      // Update feed status in DB
      if (ok) {
        await prisma.feed.update({
          where: { feed_id: resolvedTargetFeedId },
          data: { status: "moved" },
        });
      }
    }

    if (isDelete) {
      if (targetType === "feed" && resolvedTargetFeedId) {
        const ok = await deletePost(GUILD_ID, resolvedTargetFeedId, targetChannelName || "", feedCreateTimeStr, adminIdentityId);
        cliResults.push(ok ? "删帖成功" : "删帖失败");
        if (ok) {
          await prisma.feed.update({
            where: { feed_id: resolvedTargetFeedId },
            data: { status: "deleted", deleted_at: new Date() },
          });
        }
      } else if (targetType === "comment" && resolvedTargetFeedId && targetCommentId) {
        const ok = await deleteComment(
          resolvedTargetFeedId, GUILD_ID, targetCommentId,
          targetCommentAuthorId || "", feedCreateTimeStr, adminIdentityId
        );
        cliResults.push(ok ? "删评论成功" : "删评论失败");
        if (ok) {
          await prisma.comment.update({
            where: { comment_id: targetCommentId },
            data: { status: "deleted", deleted_at: new Date() },
          });
        }
      } else if (targetType === "reply") {
        // Reply deletion not supported by CLI yet, only record in DB
        cliResults.push("回复删除：仅记录（CLI暂不支持）");
      }
    }

    if (isMute && resolvedTargetAuthorId && mute?.duration) {
      // muteUser expects expiry Unix timestamp as string (current time + duration hours)
      const expiryTimestamp = String(Math.floor(Date.now() / 1000) + Number(mute.duration) * 3600);
      const ok = await muteUser(GUILD_ID, resolvedTargetAuthorId, expiryTimestamp, adminIdentityId);
      cliResults.push(ok ? `禁言${mute.duration}h成功` : "禁言失败");
    }

    // ─── Send notification ────────────────────────────────────────────
    let notificationSent = false;
    const notifType = notification?.type;
    const notifText = notification?.content || notificationText || notification?.text;

    if (notifType && notifText && resolvedTargetAuthorId) {
      // Resolve template variables
      const finalText = resolveTemplate(notifText, {
        nickname: resolvedTargetAuthor || "",
        title: targetTitle,
        link: targetShareUrl,
        reason: resolvedReason,
      });

      if (notifType === "comment" && resolvedTargetFeedId) {
        notificationSent = await postComment(resolvedTargetFeedId, GUILD_ID, finalText, feedCreateTimeStr, adminIdentityId);
      } else if (notifType === "dm") {
        notificationSent = await sendDM(GUILD_ID, resolvedTargetAuthorId, finalText, adminIdentityId);
      }

      // Update violation record with notification status
      await prisma.violation.update({
        where: { id: violation.id },
        data: {
          notification_sent: notificationSent,
          notification_text: finalText,
        },
      });

      cliResults.push(notificationSent ? "通知发送成功" : "通知发送失败");
    }

    // Re-fetch the updated violation with notification status
    const updated = await prisma.violation.findUnique({
      where: { id: violation.id },
      include: {
        feed: { select: { feed_id: true, title: true } },
        comment: { select: { comment_id: true, content_text: true } },
        reply: { select: { reply_id: true, content_text: true } },
        user: { select: { id: true, username: true, display_name: true } },
      },
    });

    const result = toCamelCase(serializeBigInt(updated)) as any;
    result.cliResults = cliResults;

    return success(result);
  } catch (err) {
    console.error("Violation create error:", err);
    const msg = err instanceof Error ? err.message : "创建违规记录失败";
    return error(msg, 500);
  }
}
