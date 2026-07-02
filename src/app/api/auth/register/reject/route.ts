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

    await prisma.platformUser.delete({
      where: { id: BigInt(userId) },
    });

    return success(null, { message: `已拒绝用户 "${user.username}" 的注册申请` });
  } catch (err) {
    console.error("Reject error:", err);
    return error("拒绝失败", 500);
  }
}
