import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, success, error, serializeBigInt } from "@/lib/api-utils";

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return unauthorized();

    const user = await prisma.platformUser.findUnique({
      where: { id: BigInt(auth.userId) },
      select: {
        id: true,
        username: true,
        display_name: true,
        role: true,
      },
    });

    if (!user) {
      return error("用户不存在", 404);
    }

    // Check identity status (admin always passes)
    let identityStatus = "ready";
    if (user.role !== "admin") {
      const identity = await prisma.adminIdentity.findFirst({
        where: { nickname: user.username },
        select: { id: true, token: true, token_expires: true, status: true },
      });
      if (!identity || !identity.token) {
        identityStatus = "needs_login";
      } else if (
        identity.token_expires &&
        identity.token_expires < new Date()
      ) {
        identityStatus = "expired";
      } else if (identity.status !== "active") {
        identityStatus = "disabled";
      }
    }

    return success({
      user: serializeBigInt({
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        role: user.role,
      }),
      identityStatus,
    });
  } catch (err) {
    console.error("Session error:", err);
    return error("获取会话信息失败", 500);
  }
}
