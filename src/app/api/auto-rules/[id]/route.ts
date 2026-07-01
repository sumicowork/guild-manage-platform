import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, forbidden, success, error, serializeBigInt, toCamelCase } from "@/lib/api-utils";

export async function PUT(
  req: NextRequest,
  ctx: RouteContext<"/api/auto-rules/[id]">
) {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return unauthorized();
    if (auth.role !== "admin") return forbidden();

    const { id } = await ctx.params;
    let ruleId: bigint;
    try {
      ruleId = BigInt(id);
    } catch {
      return error("无效的规则ID", 400);
    }

    const existing = await prisma.autoRule.findUnique({
      where: { id: ruleId },
    });
    if (!existing) {
      return error("规则不存在", 404);
    }

    const body = await req.json();
    const { name, targetAuthorId, action, targetChannelId, enabled } = body;

    if (action && !["delete", "move"].includes(action)) {
      return error("动作必须为 delete 或 move", 400);
    }

    const updated = await prisma.autoRule.update({
      where: { id: ruleId },
      data: {
        ...(name !== undefined && { name }),
        ...(targetAuthorId !== undefined && { target_author_id: targetAuthorId }),
        ...(action !== undefined && { action }),
        ...(targetChannelId !== undefined && { target_channel_id: targetChannelId || null }),
        ...(enabled !== undefined && { enabled }),
      },
    });

    const raw = serializeBigInt(updated);
    const mapped = toCamelCase(raw) as any;
    return success({ ...mapped, id: Number(mapped.id) });
  } catch (err) {
    console.error("Auto rule update error:", err);
    return error("更新自动规则失败", 500);
  }
}

export async function DELETE(
  req: NextRequest,
  ctx: RouteContext<"/api/auto-rules/[id]">
) {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return unauthorized();
    if (auth.role !== "admin") return forbidden();

    const { id } = await ctx.params;
    let ruleId: bigint;
    try {
      ruleId = BigInt(id);
    } catch {
      return error("无效的规则ID", 400);
    }

    const existing = await prisma.autoRule.findUnique({
      where: { id: ruleId },
    });
    if (!existing) {
      return error("规则不存在", 404);
    }

    await prisma.autoRule.delete({
      where: { id: ruleId },
    });

    return success({ deleted: true });
  } catch (err) {
    console.error("Auto rule delete error:", err);
    return error("删除自动规则失败", 500);
  }
}
