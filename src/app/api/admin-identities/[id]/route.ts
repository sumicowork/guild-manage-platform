import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, success, error, serializeBigInt } from "@/lib/api-utils";
import { encrypt } from "@/lib/crypto";

export async function PUT(
  req: NextRequest,
  ctx: RouteContext<"/api/admin-identities/[id]">
) {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return unauthorized();

    const { id } = await ctx.params;
    const identityId = BigInt(id);

    const body = await req.json();
    const { nickname, token, status } = body;

    const existing = await prisma.adminIdentity.findUnique({
      where: { id: identityId },
    });
    if (!existing) {
      return error("管理员身份不存在", 404);
    }

    const updateData: Record<string, unknown> = {};
    if (nickname !== undefined) updateData.nickname = nickname;
    if (status !== undefined) updateData.status = status;
    if (token !== undefined) updateData.token = encrypt(token);

    const updated = await prisma.adminIdentity.update({
      where: { id: identityId },
      data: updateData,
    });

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

    const { id } = await ctx.params;
    const identityId = BigInt(id);

    const existing = await prisma.adminIdentity.findUnique({
      where: { id: identityId },
    });
    if (!existing) {
      return error("管理员身份不存在", 404);
    }

    await prisma.adminIdentity.delete({
      where: { id: identityId },
    });

    return success({ deleted: true });
  } catch (err) {
    console.error("Admin identity delete error:", err);
    return error("删除管理员身份失败", 500);
  }
}
