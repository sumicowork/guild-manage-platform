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

    // Look up member by tinyid (client sends tinyid) or BigInt id
    let member;
    try {
      const memberId = BigInt(id);
      member = await prisma.member.findUnique({ where: { id: memberId } });
    } catch {
      member = await prisma.member.findUnique({ where: { tinyid: id } });
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

    // Fetch violation history targeting this member
    const violations = await prisma.violation.findMany({
      where: { target_author_id: member.tinyid },
      orderBy: { created_at: "desc" },
      take: 50,
    });

    // Transform to match client's MemberHistory interface
    const rawPosts = toCamelCase(serializeBigInt(posts)) as any[];
    const rawComments = toCamelCase(serializeBigInt(comments)) as any[];
    const rawViolations = toCamelCase(serializeBigInt(violations)) as any[];

    const result = {
      feeds: rawPosts.map((p: any) => ({
        id: String(p.id),
        title: p.title,
        createdAt: p.createTime,
        status: p.status,
      })),
      comments: rawComments.map((c: any) => ({
        id: String(c.id),
        content: c.contentText || c.content,
        createdAt: c.createTime,
        feedTitle: c.feed?.title ?? '',
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
