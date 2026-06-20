import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, success, error, serializeBigInt } from "@/lib/api-utils";

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

    return success(serializeBigInt(feed));
  } catch (err) {
    console.error("Feed detail error:", err);
    return error("获取帖子详情失败", 500);
  }
}
