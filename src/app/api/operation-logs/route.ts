import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import {
  getAuthUser,
  unauthorized,
  forbidden,
  success,
  parsePage,
  parsePageSize,
} from "@/lib/api-utils";

/**
 * GET /api/operation-logs
 * 查询操作日志（仅 admin）
 *
 * 查询参数：
 *   page      页码（默认 1）
 *   pageSize  每页条数（默认 20，最大 100）
 *   action    按动作过滤（精确匹配，如 "violation.delete"）
 *   targetType 揔 target_type 过滤
 *   targetId  按目标 ID 过滤
 *   operatorId 按操作者 ID 过滤
 */
export async function GET(req: NextRequest) {
  const auth = await getAuthUser(req);
  if (!auth) return unauthorized();
  if (auth.role !== "admin") return forbidden();

  const url = new URL(req.url);
  const page = parsePage(url.searchParams.get("page"), 1);
  const pageSize = parsePageSize(url.searchParams.get("pageSize"), 20, 100);

  const action = url.searchParams.get("action");
  const targetType = url.searchParams.get("targetType");
  const targetId = url.searchParams.get("targetId");
  const operatorIdRaw = url.searchParams.get("operatorId");

  let operatorId: bigint | undefined;
  if (operatorIdRaw) {
    try {
      operatorId = BigInt(operatorIdRaw);
    } catch {
      // 忽略无效 ID
    }
  }

  const where: Record<string, unknown> = {};
  if (action) where.action = action;
  if (targetType) where.target_type = targetType;
  if (targetId) where.target_id = targetId;
  if (operatorId) where.operator_id = operatorId;

  const [total, logs] = await Promise.all([
    prisma.operationLog.count({ where }),
    prisma.operationLog.findMany({
      where,
      orderBy: { created_at: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return success(
    logs.map((l) => ({
      id: String(l.id),
      action: l.action,
      targetType: l.target_type,
      targetId: l.target_id,
      snapshot: l.snapshot,
      operatorId: String(l.operator_id),
      operatorName: l.operator_name,
      detail: l.detail,
      createdAt: l.created_at,
    })),
    { page, pageSize, total }
  );
}
