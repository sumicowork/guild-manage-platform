import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, success, error, serializeBigInt } from "@/lib/api-utils";

// Helper to resolve member by BigInt id or tinyid string
async function findMember(idOrTinyid: string) {
  try {
    const memberId = BigInt(idOrTinyid);
    return prisma.member.findUnique({ where: { id: memberId } });
  } catch {
    return prisma.member.findUnique({ where: { tinyid: idOrTinyid } });
  }
}

export async function POST(
  req: NextRequest,
  ctx: RouteContext<"/api/members/[id]/tags">
) {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return unauthorized();

    const { id } = await ctx.params;
    const member = await findMember(id);
    if (!member) return error("成员不存在", 404);

    const body = await req.json();
    const { tag } = body;
    if (!tag) return error("缺少 tag 参数", 400);

    const memberTag = await prisma.memberTag.create({
      data: {
        member_id: member.id,
        tag,
        created_by: BigInt(auth.userId),
      },
    });

    return success(serializeBigInt(memberTag));
  } catch (err: any) {
    if (err?.code === "P2002") return error("标签已存在", 409);
    console.error("Add tag error:", err);
    return error("添加标签失败", 500);
  }
}
