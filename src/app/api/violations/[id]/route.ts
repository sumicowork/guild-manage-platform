import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, forbidden, success, error, serializeBigInt } from "@/lib/api-utils";

/**
 * DELETE /api/violations/[id]
 * 删除一条违规记录（硬删除，但在 operation_logs 表记录审计快照）
 */
export async function DELETE(
  req: NextRequest,
  ctx: RouteContext<"/api/violations/[id]">
) {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return unauthorized();
    if (auth.role !== "admin") return forbidden();

    const { id } = await ctx.params;
    const violationId = Number(id);

    if (isNaN(violationId)) {
      return error("无效的违规记录ID", 400);
    }

    // 确认记录存在
    const existing = await prisma.violation.findUnique({
      where: { id: violationId },
    });

    if (!existing) {
      return error("违规记录不存在", 404);
    }

    // 事务：先写审计日志，再硬删除违规记录
    await prisma.$transaction([
      prisma.operationLog.create({
        data: {
          action: "violation.delete",
          target_type: "violation",
          target_id: String(violationId),
          snapshot: serializeBigInt(existing) as object,
          operator_id: BigInt(auth.userId),
          operator_name: auth.username,
          detail: `删除违规记录 #${violationId}（target=${existing.target_type}:${existing.target_id}, action=${existing.action_type}）`,
        },
      }),
      prisma.violation.delete({
        where: { id: violationId },
      }),
    ]);

    return success({ deleted: true });
  } catch (err) {
    console.error("Delete violation error:", err);
    return error("删除违规记录失败", 500);
  }
}
