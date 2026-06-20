import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, success, error, serializeBigInt, toCamelCase } from "@/lib/api-utils";

export async function GET(
  req: NextRequest,
  ctx: RouteContext<"/api/feeds/[id]">
) {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return unauthorized();

    const { id } = await ctx.params;

    const feed = await prisma.feed.findUnique({
      where: { feed_id: id },
      include: {
        comments: {
          orderBy: { create_time: "asc" },
          include: {
            replies: {
              orderBy: { create_time: "asc" },
            },
          },
        },
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

    if (!feed) {
      return error("帖子不存在", 404);
    }

    const raw = serializeBigInt(feed);
    const camel = toCamelCase(raw) as any;
    // Map fields to match client Feed interface
    const mapped = {
      ...camel,
      likeCount: camel.preferCount ?? 0,
      createdAt: camel.createTime ?? camel.createdAt,
      channelId: '',
      comments: (camel.comments || []).map((c: any) => ({
        ...c,
        content: c.contentText || '',
        likeCount: c.likeCount ?? 0,
        createdAt: c.createTime ?? c.createdAt,
        replies: (c.replies || []).map((r: any) => ({
          ...r,
          content: r.contentText || '',
          likeCount: r.likeCount ?? 0,
          createdAt: r.createTime ?? r.createdAt,
        })),
      })),
    };

    return success(mapped);
  } catch (err) {
    console.error("Feed detail error:", err);
    return error("获取帖子详情失败", 500);
  }
}
