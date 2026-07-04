import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, forbidden, success, error, serializeBigInt } from "@/lib/api-utils";
import { encrypt } from "@/lib/crypto";
import { invalidateIdentityPool } from "@/lib/cli/executor";

export async function PUT(
  req: NextRequest,
  ctx: RouteContext<"/api/admin-identities/[id]">
) {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return unauthorized();
    if (auth.role !== "admin") return forbidden();

    const { id } = await ctx.params;
    let identityId: bigint;
    try {
      identityId = BigInt(id);
    } catch {
      return error("无效的身份ID", 400);
    }

    const body = await req.json();
    const { nickname, token } = body;

    const existing = await prisma.adminIdentity.findUnique({
      where: { id: identityId },
    });
    if (!existing) {
      return error("管理员身份不存在", 404);
    }

    const updateData: Record<string, unknown> = {};
    if (nickname !== undefined) updateData.nickname = nickname;
    if (token !== undefined) updateData.token = encrypt(token);

    const updated = await prisma.adminIdentity.update({
      where: { id: identityId },
      data: updateData,
    });

    // Invalidate cache so identity pool reflects updated token
    invalidateIdentityPool();

    // Mask the token in response
    return success(
      serializeBigInt({
        ...updated,
        token: updated.token.length > 10
          ? updated.token.slice(0, 10) + "..."
          : updated.token,
      })
    );
  } catch (err) {
    console.error("Admin identity update error:", err);
    return error("更新管理员身份失败", 500);
  }
}

export async function DELETE(
  req: NextRequest,
  ctx: RouteContext<"/api/admin-identities/[id]">
) {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return unauthorized();
    if (auth.role !== "admin") return forbidden();

    const { id } = await ctx.params;
    let identityId: bigint;
    try {
      identityId = BigInt(id);
    } catch {
      return error("无效的身份ID", 400);
    }

    const existing = await prisma.adminIdentity.findUnique({
      where: { id: identityId },
    });
    if (!existing) {
      return error("管理员身份不存在", 404);
    }

    await prisma.adminIdentity.delete({
      where: { id: identityId },
    });

    // Invalidate cache so deleted identity is no longer selected
    invalidateIdentityPool();

    return success({ deleted: true });
  } catch (err) {
    console.error("Admin identity delete error:", err);
    return error("删除管理员身份失败", 500);
  }
}
