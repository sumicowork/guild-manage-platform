import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { verifyPassword, signToken } from "@/lib/auth";
import { error, success, serializeBigInt } from "@/lib/api-utils";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { username, password } = body;

    if (!username || !password) {
      return error("用户名和密码不能为空", 400);
    }

    const user = await prisma.platformUser.findUnique({
      where: { username },
    });

    if (!user) {
      return error("用户名或密码错误", 401);
    }

    const isValid = await verifyPassword(password, user.password);
    if (!isValid) {
      return error("用户名或密码错误", 401);
    }

    const token = await signToken({
      userId: Number(user.id),
      username: user.username,
      role: user.role,
    });

    return success({
      token,
      user: serializeBigInt({
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        role: user.role,
      }),
    });
  } catch (err) {
    console.error("Login error:", err);
    return error("登录失败", 500);
  }
}
