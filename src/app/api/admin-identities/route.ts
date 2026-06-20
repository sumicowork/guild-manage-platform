import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, success, error, serializeBigInt } from "@/lib/api-utils";
import { encrypt } from "@/lib/crypto";

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return unauthorized();

    const identities = await prisma.adminIdentity.findMany({
      orderBy: { created_at: "desc" },
    });

    // Mask tokens — only show first 10 chars
    const masked = identities.map((identity) => ({
      ...identity,
      token: identity.token.length > 10
        ? identity.token.slice(0, 10) + "..."
        : identity.token,
    }));

    return success(serializeBigInt(masked));
  } catch (err) {
    console.error("Admin identities list error:", err);
    return error("获取管理员身份列表失败", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return unauthorized();

    const body = await req.json();
    const { tinyid, nickname, token } = body;

    if (!tinyid || !nickname || !token) {
      return error("缺少必要参数：tinyid, nickname, token", 400);
    }

    // Check uniqueness
    const existing = await prisma.adminIdentity.findUnique({
      where: { tinyid },
    });
    if (existing) {
      return error("该 tinyid 已存在", 409);
    }

    const encryptedToken = encrypt(token);

    const identity = await prisma.adminIdentity.create({
      data: {
        tinyid,
        nickname,
        token: encryptedToken,
      },
    });

    // Mask the token in response
    return success(
      serializeBigInt({
        ...identity,
        token: identity.token.slice(0, 10) + "...",
      })
    );
  } catch (err) {
    console.error("Admin identity create error:", err);
    return error("创建管理员身份失败", 500);
  }
}
