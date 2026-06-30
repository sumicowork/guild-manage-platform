import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  rotateRefreshToken,
  signAccessToken,
  buildAccessCookie,
  buildRefreshCookie,
} from "@/lib/auth";
import {
  error,
  success,
  getRefreshTokenFromReq,
  serializeBigInt,
} from "@/lib/api-utils";

/**
 * POST /api/auth/refresh
 * Exchanges a valid refresh token (from cookie) for a new access token + new refresh token.
 * Rotation: old refresh token is revoked, new one issued.
 *
 * No body required — refresh token read from httpOnly cookie.
 *
 * Response: 200 with new cookies set; 401 if refresh token missing/invalid/expired.
 */
export async function POST(req: NextRequest) {
  const refreshToken = getRefreshTokenFromReq(req);
  if (!refreshToken) {
    return error("缺少 refresh token", 401);
  }

  const rotated = await rotateRefreshToken(refreshToken);
  if (!rotated) {
    return error("refresh token 无效或已过期，请重新登录", 401);
  }

  const [newRefreshRaw, userId] = rotated;

  // Load user to sign a fresh access token
  const user = await prisma.platformUser.findUnique({
    where: { id: userId },
    select: { id: true, username: true, role: true, display_name: true },
  });
  if (!user) {
    return error("用户不存在", 401);
  }

  const accessToken = await signAccessToken({
    userId: Number(user.id),
    username: user.username,
    role: user.role,
  });

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
  res.headers.append("Set-Cookie", buildRefreshCookie(newRefreshRaw));
  return res;
}
