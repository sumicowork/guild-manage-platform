import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, forbidden, success, error, serializeBigInt, toCamelCase } from "@/lib/api-utils";

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return unauthorized();

    const rules = await prisma.autoRule.findMany({
      orderBy: { created_at: "desc" },
    });

    // Batch lookup member names for target author tinyids
    const tinyIds = [...new Set(rules.map((r) => r.target_author_id).filter(Boolean))];
    const members =
      tinyIds.length > 0
        ? await prisma.member.findMany({
            where: { tinyid: { in: tinyIds } },
            select: { tinyid: true, nickname: true },
          })
        : [];
    const memberNameMap = new Map(members.map((m) => [m.tinyid, m.nickname]));

    const rawRules = serializeBigInt(rules);
    const mapped = (toCamelCase(rawRules) as any[]).map((r: any) => ({
      ...r,
      id: Number(r.id),
      targetAuthorName: memberNameMap.get(r.targetAuthorId) || null,
    }));
    return success(mapped);
  } catch (err) {
    console.error("Auto rules list error:", err);
    return error("获取自动规则列表失败", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return unauthorized();
    if (auth.role !== "admin") return forbidden();

    const body = await req.json();
    const { name, targetAuthorId, action, targetChannelId, enabled } = body;

    if (!name || !targetAuthorId) {
      return error("名称和目标作者ID不能为空", 400);
    }

    if (action && !["delete", "move"].includes(action)) {
      return error("动作必须为 delete 或 move", 400);
    }

    if (action === "move" && !targetChannelId) {
      return error("移帖操作必须指定目标版块ID", 400);
    }

    const rule = await prisma.autoRule.create({
      data: {
        name,
        target_author_id: targetAuthorId,
        action: action || "delete",
        target_channel_id: targetChannelId || null,
        enabled: enabled !== undefined ? enabled : true,
      },
    });

    const raw = serializeBigInt(rule);
    const mapped = toCamelCase(raw) as any;
    return success({ ...mapped, id: Number(mapped.id) });
  } catch (err) {
    console.error("Auto rule create error:", err);
    return error("创建自动规则失败", 500);
  }
}
