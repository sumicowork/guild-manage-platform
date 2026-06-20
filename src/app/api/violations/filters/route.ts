import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, success, error } from "@/lib/api-utils";

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return unauthorized();

    const [reasonGroups, users] = await Promise.all([
      prisma.violation.groupBy({
        by: ["violation_reason"],
        _count: true,
      }),
      prisma.platformUser.findMany({
        select: { username: true },
        distinct: ["username"],
      }),
    ]);

    const reasons = reasonGroups
      .map((g) => g.violation_reason)
      .filter(Boolean);
    const operators = users.map((u) => u.username);

    return success({ reasons, operators });
  } catch (err) {
    console.error("Violation filters error:", err);
    return error("获取筛选项失败", 500);
  }
}
