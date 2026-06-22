import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, success, error, serializeBigInt, toCamelCase } from "@/lib/api-utils";

export async function GET(
  req: NextRequest,
  ctx: RouteContext<"/api/members/[id]/history">
) {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return unauthorized();

    const { id } = await ctx.params;

    // 先按 tinyid 查找（前端总是发送 tinyid），找不到再尝试 BigInt id
    let member = await prisma.member.findUnique({ where: { tinyid: id } });
    if (!member) {
      try {
        const memberId = BigInt(id);
        member = await prisma.member.findUnique({ where: { id: memberId } });
      } catch {
        // id 不是有效 BigInt，忽略
      }
    }

    if (!member) {
      return error("成员不存在", 404);
    }

    // Fetch post history
    const posts = await prisma.feed.findMany({
      where: { author_id: member.tinyid },
      orderBy: { create_time: "desc" },
      take: 50,
    });

    // Fetch comment history
    const comments = await prisma.comment.findMany({
      where: { author_id: member.tinyid },
      orderBy: { create_time: "desc" },
      take: 50,
      include: {
        feed: {
          select: {
            feed_id: true,
            title: true,
          },
        },
      },
    });

    // Fetch reply history
    const replies = await prisma.reply.findMany({
      where: { author_id: member.tinyid },
      orderBy: { create_time: "desc" },
      take: 50,
      include: {
        comment: {
          select: {
            comment_id: true,
            content_text: true,
            feed: {
              select: {
                feed_id: true,
                title: true,
              },
            },
          },
        },
      },
    });

    // Fetch violation history targeting this member
    const violations = await prisma.violation.findMany({
      where: { target_author_id: member.tinyid },
      orderBy: { created_at: "desc" },
      take: 50,
    });

    // Compute aggregate stats
    const [totalLikes, feedCount, commentCount, replyCount] = await Promise.all([
      prisma.feed.aggregate({
        where: { author_id: member.tinyid },
        _sum: { prefer_count: true },
      }),
      prisma.feed.count({ where: { author_id: member.tinyid } }),
      prisma.comment.count({ where: { author_id: member.tinyid } }),
      prisma.reply.count({ where: { author_id: member.tinyid } }),
    ]);

    // Transform to match client's MemberHistory interface
    const rawPosts = toCamelCase(serializeBigInt(posts)) as any[];
    const rawComments = toCamelCase(serializeBigInt(comments)) as any[];
    const rawReplies = toCamelCase(serializeBigInt(replies)) as any[];
    const rawViolations = toCamelCase(serializeBigInt(violations)) as any[];
    const rawMember = toCamelCase(serializeBigInt(member)) as any;

    const result = {
      member: {
        tinyid: rawMember.tinyid,
        nickname: rawMember.nickname,
        globalNickname: rawMember.globalNickname,
        role: rawMember.role,
        status: rawMember.status,
        joinedAt: rawMember.joinTime,
      },
      stats: {
        feedCount,
        commentCount,
        replyCount,
        likeCount: totalLikes._sum.prefer_count ?? 0,
        violationCount: violations.length,
      },
      feeds: rawPosts.map((p: any) => ({
        id: String(p.id),
        feedId: p.feedId,
        title: p.title,
        content: p.content?.slice(0, 100) ?? '',
        createdAt: p.createTime,
        status: p.status,
        likeCount: p.preferCount ?? 0,
        commentCount: p.commentCount ?? 0,
      })),
      comments: rawComments.map((c: any) => ({
        id: String(c.id),
        commentId: c.commentId,
        content: c.contentText || c.content,
        createdAt: c.createTime,
        feedId: c.feed?.feedId ?? '',
        feedTitle: c.feed?.title ?? '',
        likeCount: c.preferCount ?? 0,
      })),
      replies: rawReplies.map((r: any) => ({
        id: String(r.id),
        replyId: r.replyId,
        content: r.contentText || r.content,
        createdAt: r.createTime,
        feedId: r.comment?.feed?.feedId ?? '',
        feedTitle: r.comment?.feed?.title ?? '',
        commentContent: r.comment?.contentText?.slice(0, 50) ?? '',
        targetUser: r.targetUser,
      })),
      violations: rawViolations.map((v: any) => ({
        id: Number(v.id),
        reason: v.violationReason,
        actionType: v.actionType,
        createdAt: v.createdAt,
      })),
    };

    return success(result);
  } catch (err) {
    console.error("Member history error:", err);
    return error("获取成员历史失败", 500);
  }
}
