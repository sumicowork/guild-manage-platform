import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, success, error, serializeBigInt, toCamelCase } from "@/lib/api-utils";

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return unauthorized();

    const reasons = await prisma.violationReason.findMany({
      orderBy: { sort_order: "asc" },
    });

    const rawReasons = serializeBigInt(reasons);
    const mapped = (toCamelCase(rawReasons) as any[]).map((r: any) => ({
      ...r,
      id: Number(r.id),
    }));
    return success(mapped);
  } catch (err) {
    console.error("Violation reasons list error:", err);
    return error("获取违规原因列表失败", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return unauthorized();

    const body = await req.json();
    const { name, notificationTemplate } = body;

    if (!name) {
      return error("名称不能为空", 400);
    }

    // Check uniqueness
    const existing = await prisma.violationReason.findUnique({
      where: { name },
    });
    if (existing) {
      return error("该违规原因已存在", 409);
    }

    // Get max sort_order
    const maxSort = await prisma.violationReason.aggregate({
      _max: { sort_order: true },
    });
    const nextSortOrder = (maxSort._max.sort_order ?? 0) + 1;

    const reason = await prisma.violationReason.create({
      data: {
        name,
        notification_template: notificationTemplate || null,
        sort_order: nextSortOrder,
      },
    });

    return success({ ...toCamelCase(serializeBigInt(reason)) as any, id: Number(reason.id) });
  } catch (err) {
    console.error("Violation reason create error:", err);
    return error("创建违规原因失败", 500);
  }
}
