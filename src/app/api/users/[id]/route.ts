import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, success, error } from "@/lib/api-utils";

export async function DELETE(
  req: NextRequest,
  ctx: RouteContext<"/api/users/[id]">
) {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return unauthorized();

    const { id } = await ctx.params;
    await prisma.platformUser.delete({
      where: { id: Number(id) },
    });

    return success({ deleted: true });
  } catch (err) {
    console.error("Delete user error:", err);
    return error("删除用户失败", 500);
  }
}
