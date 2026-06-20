import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, success, error, serializeBigInt } from "@/lib/api-utils";

export async function PUT(
  req: NextRequest,
  ctx: RouteContext<"/api/violation-reasons/[id]">
) {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return unauthorized();

    const { id } = await ctx.params;
    const reasonId = BigInt(id);

    const body = await req.json();
    const { name, notificationTemplate, sortOrder } = body;

    const existing = await prisma.violationReason.findUnique({
      where: { id: reasonId },
    });
    if (!existing) {
      return error("违规原因不存在", 404);
    }

    // If updating name, check uniqueness
    if (name && name !== existing.name) {
      const conflict = await prisma.violationReason.findUnique({
        where: { name },
      });
      if (conflict) {
        return error("该违规原因名称已存在", 409);
      }
    }

    const updated = await prisma.violationReason.update({
      where: { id: reasonId },
      data: {
        ...(name !== undefined && { name }),
        ...(notificationTemplate !== undefined && {
          notification_template: notificationTemplate,
        }),
        ...(sortOrder !== undefined && { sort_order: sortOrder }),
      },
    });

    return success(serializeBigInt(updated));
  } catch (err) {
    console.error("Violation reason update error:", err);
    return error("更新违规原因失败", 500);
  }
}

export async function DELETE(
  req: NextRequest,
  ctx: RouteContext<"/api/violation-reasons/[id]">
) {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return unauthorized();

    const { id } = await ctx.params;
    const reasonId = BigInt(id);

    const existing = await prisma.violationReason.findUnique({
      where: { id: reasonId },
    });
    if (!existing) {
      return error("违规原因不存在", 404);
    }

    if (existing.is_builtin) {
      return error("内置违规原因不可删除", 403);
    }

    await prisma.violationReason.delete({
      where: { id: reasonId },
    });

    return success({ deleted: true });
  } catch (err) {
    console.error("Violation reason delete error:", err);
    return error("删除违规原因失败", 500);
  }
}
