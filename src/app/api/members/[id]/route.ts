import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, success, error, serializeBigInt } from "@/lib/api-utils";

export async function GET(
  req: NextRequest,
  ctx: RouteContext<"/api/members/[id]">
) {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return unauthorized();

    const { id } = await ctx.params;
    const memberId = BigInt(id);

    const member = await prisma.member.findUnique({
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

    return success(
      serializeBigInt({
        ...member,
        posts,
        comments,
      })
    );
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
    const memberId = BigInt(id);

    const body = await req.json();
    const { tags } = body;

    if (!Array.isArray(tags)) {
      return error("tags 必须是数组", 400);
    }

    // Check member exists
    const member = await prisma.member.findUnique({
      where: { id: memberId },
    });
    if (!member) {
      return error("成员不存在", 404);
    }

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
