import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, forbidden, success, error } from "@/lib/api-utils";

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return unauthorized();
    if (auth.role !== "admin") return forbidden();

    const { userId } = await req.json();
    if (!userId) return error("缺少用户 ID", 400);

    const user = await prisma.platformUser.findUnique({
      where: { id: BigInt(userId) },
    });
    if (!user) return error("用户不存在", 404);
    if (user.status !== "pending") return error("该用户不在待审批状态", 400);

    await prisma.platformUser.update({
      where: { id: BigInt(userId) },
      data: { status: "active" },
    });

    return success(null, { message: `用户 "${user.username}" 已审批通过` });
  } catch (err) {
    console.error("Approve error:", err);
    return error("审批失败", 500);
  }
}
