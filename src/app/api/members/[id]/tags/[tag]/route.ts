import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, success, error } from "@/lib/api-utils";

// Helper to resolve member by BigInt id or tinyid string
async function findMember(idOrTinyid: string) {
  try {
    const memberId = BigInt(idOrTinyid);
    return prisma.member.findUnique({ where: { id: memberId } });
  } catch {
    return prisma.member.findUnique({ where: { tinyid: idOrTinyid } });
  }
}

export async function DELETE(
  req: NextRequest,
  ctx: RouteContext<"/api/members/[id]/tags/[tag]">
) {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return unauthorized();

    const { id, tag } = await ctx.params;
    const member = await findMember(id);
    if (!member) return error("成员不存在", 404);

    const decodedTag = decodeURIComponent(tag);
    await prisma.memberTag.deleteMany({
      where: { member_id: member.id, tag: decodedTag },
    });

    return success({ deleted: true });
  } catch (err) {
    console.error("Remove tag error:", err);
    return error("移除标签失败", 500);
  }
}
