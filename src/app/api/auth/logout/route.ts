import { NextRequest, NextResponse } from "next/server";
import {
  buildClearAccessCookie,
  buildClearRefreshCookie,
  verifyRefreshToken,
  revokeAllUserRefreshTokens,
} from "@/lib/auth";
import {
  success,
  getRefreshTokenFromReq,
} from "@/lib/api-utils";

/**
 * POST /api/auth/logout
 * Revokes the user's refresh tokens and clears both cookies.
 */
export async function POST(req: NextRequest) {
  try {
    const refreshToken = getRefreshTokenFromReq(req);
    if (refreshToken) {
      const userId = await verifyRefreshToken(refreshToken);
      if (userId) {
        await revokeAllUserRefreshTokens(userId);
      }
    }
  } catch (err) {
    console.error("Logout error (non-fatal):", err);
  }

  const res = NextResponse.json({ success: true, data: { loggedOut: true } });
  res.headers.append("Set-Cookie", buildClearAccessCookie());
  res.headers.append("Set-Cookie", buildClearRefreshCookie());
  return res;
}
