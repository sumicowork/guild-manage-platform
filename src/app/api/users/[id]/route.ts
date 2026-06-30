import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, forbidden, success, error } from "@/lib/api-utils";

export async function DELETE(
  req: NextRequest,
  ctx: RouteContext<"/api/users/[id]">
) {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return unauthorized();
    if (auth.role !== "admin") return forbidden();

    const { id } = await ctx.params;
    const userId = Number(id);
    if (isNaN(userId)) {
      return error("无效的用户ID", 400);
    }

    // Prevent self-deletion
    if (userId === auth.userId) {
      return error("不能删除自己", 400);
    }

    const existing = await prisma.platformUser.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!existing) {
      return error("用户不存在", 404);
    }

    await prisma.platformUser.delete({
      where: { id: userId },
    });

    return success({ deleted: true });
  } catch (err) {
    console.error("Delete user error:", err);
    return error("删除用户失败", 500);
  }
}
