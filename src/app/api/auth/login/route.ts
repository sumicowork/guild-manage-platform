import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  verifyPassword,
  signAccessToken,
  issueRefreshToken,
  buildAccessCookie,
  buildRefreshCookie,
  revokeAllUserRefreshTokens,
} from "@/lib/auth";
import { error, serializeBigInt } from "@/lib/api-utils";

/**
 * POST /api/auth/login
 * Authenticates user, sets httpOnly cookies for access + refresh tokens.
 *
 * Body: { username, password }
 * Response: { user: { id, username, displayName, role } }
 *           (token is in cookie, not in body)
 */
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

    // Revoke any prior refresh tokens for this user (single-session sign-in)
    await revokeAllUserRefreshTokens(user.id);

    const accessToken = await signAccessToken({
      userId: Number(user.id),
      username: user.username,
      role: user.role,
    });
    const refreshToken = await issueRefreshToken(user.id);

    const res = NextResponse.json({
      success: true,
      data: {
        user: serializeBigInt({
          id: user.id,
          username: user.username,
          displayName: user.display_name,
          role: user.role,
        }),
      },
    });
    res.headers.append("Set-Cookie", buildAccessCookie(accessToken));
    res.headers.append("Set-Cookie", buildRefreshCookie(refreshToken));
    return res;
  } catch (err) {
    console.error("Login error:", err);
    return error("登录失败", 500);
  }
}
