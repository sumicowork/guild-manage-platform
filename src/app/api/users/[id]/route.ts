import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, forbidden, success, error } from "@/lib/api-utils";
import { hashPassword } from "@/lib/auth";

export async function PUT(
  req: NextRequest,
  ctx: RouteContext<"/api/users/[id]">
) {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return unauthorized();
    if (auth.role !== "admin") return forbidden();

    const { id } = await ctx.params;
    const userId = Number(id);
    if (isNaN(userId)) return error("无效的用户ID", 400);

    const existing = await prisma.platformUser.findUnique({
      where: { id: userId },
      select: { id: true, username: true },
    });
    if (!existing) return error("用户不存在", 404);

    const body = await req.json();
    const { password, role, status } = body;
    const data: Record<string, unknown> = {};

    if (password !== undefined) {
      if (typeof password !== "string" || password.length < 6) {
        return error("密码至少需要 6 个字符", 400);
      }
      data.password = await hashPassword(password);
    }
    if (role !== undefined) {
      if (!["admin", "operator"].includes(role)) {
        return error("无效的角色", 400);
      }
      // Prevent self-demotion
      if (userId === auth.userId && role !== "admin") {
        return error("不能降级自己的角色", 400);
      }
      data.role = role;
    }
    if (status !== undefined) {
      if (!["active", "disabled"].includes(status)) {
        return error("无效的状态", 400);
      }
      data.status = status;
    }

    if (Object.keys(data).length === 0) {
      return error("没有需要修改的字段", 400);
    }

    await prisma.platformUser.update({
      where: { id: userId },
      data,
    });

    return success({ updated: true, username: existing.username });
  } catch (err) {
    console.error("Update user error:", err);
    return error("修改用户失败", 500);
  }
}

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
