import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, forbidden, success, error, serializeBigInt } from "@/lib/api-utils";

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return unauthorized();
    if (auth.role !== "admin") return forbidden();

    const users = await prisma.platformUser.findMany({
      where: { status: "pending" },
      select: { id: true, username: true, created_at: true },
      orderBy: { created_at: "asc" },
    });

    return success(serializeBigInt(users));
  } catch (err) {
    console.error("Pending applications error:", err);
    return error("获取待审批列表失败", 500);
  }
}
