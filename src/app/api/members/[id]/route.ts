import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, success, error, serializeBigInt, toCamelCase } from "@/lib/api-utils";

// Helper to resolve member by BigInt id or tinyid string
async function findMember(idOrTinyid: string) {
  try {
    const memberId = BigInt(idOrTinyid);
    return prisma.member.findUnique({ where: { id: memberId } });
  } catch {
    return prisma.member.findUnique({ where: { tinyid: idOrTinyid } });
  }
}

export async function GET(
  req: NextRequest,
  ctx: RouteContext<"/api/members/[id]">
) {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return unauthorized();

    const { id } = await ctx.params;

    // Look up member by BigInt id or tinyid
    let member;
    try {
      const memberId = BigInt(id);
      member = await prisma.member.findUnique({
        where: { id: memberId },
        include: {
          tags: true,
          violations: {
            orderBy: { created_at: "desc" },
            include: {
              user: {
                select: {
                  id: true,
                  username: true,
                  display_name: true,
                },
              },
            },
          },
        },
      });
    } catch {
      member = await prisma.member.findUnique({
        where: { tinyid: id },
        include: {
          tags: true,
          violations: {
            orderBy: { created_at: "desc" },
            include: {
              user: {
                select: {
                  id: true,
                  username: true,
                  display_name: true,
                },
              },
            },
          },
        },
      });
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

    const rawMember = serializeBigInt({ ...member, posts, comments });
    const camelMember = toCamelCase(rawMember) as any;
    const result = {
      ...camelMember,
      tags: (camelMember.tags || []).map((t: any) => t.tag),
      feedCount: camelMember.postCount ?? 0,
      likeCount: 0,
      joinedAt: camelMember.joinTime ?? null,
      feeds: (camelMember.posts || []).map((p: any) => ({
        id: String(p.id),
        title: p.title,
        createdAt: p.createTime,
        status: p.status,
      })),
      comments: (camelMember.comments || []).map((c: any) => ({
        id: String(c.id),
        content: c.contentText || c.content,
        createdAt: c.createTime,
        feedTitle: c.feed?.title ?? '',
      })),
      violations: (camelMember.violations || []).map((v: any) => ({
        id: Number(v.id),
        reason: v.violationReason,
        actionType: v.actionType,
        createdAt: v.createdAt,
      })),
    };

    return success(result);
  } catch (err) {
    console.error("Member detail error:", err);
    return error("获取成员详情失败", 500);
  }
}

export async function PUT(
  req: NextRequest,
  ctx: RouteContext<"/api/members/[id]">
) {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return unauthorized();

    const { id } = await ctx.params;

    const body = await req.json();
    const { tags } = body;

    if (!Array.isArray(tags)) {
      return error("tags 必须是数组", 400);
    }

    // Check member exists (by BigInt id or tinyid)
    const member = await findMember(id);
    if (!member) {
      return error("成员不存在", 404);
    }

    const memberId = member.id;

    // Replace all tags in a transaction
    await prisma.$transaction(async (tx) => {
      // Remove existing tags
      await tx.memberTag.deleteMany({
        where: { member_id: memberId },
      });

      // Add new tags
      if (tags.length > 0) {
        await tx.memberTag.createMany({
          data: tags.map((tag: string) => ({
            member_id: memberId,
            tag,
            created_by: BigInt(auth.userId),
          })),
        });
      }
    });

    const updated = await prisma.member.findUnique({
      where: { id: memberId },
      include: { tags: true },
    });

    return success(serializeBigInt(updated));
  } catch (err) {
    console.error("Member update error:", err);
    return error("更新成员标签失败", 500);
  }
}
