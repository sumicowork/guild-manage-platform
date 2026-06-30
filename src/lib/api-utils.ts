import { NextRequest, NextResponse } from "next/server";
import { verifyToken, TokenPayload, ACCESS_COOKIE_NAME, REFRESH_COOKIE_NAME } from "@/lib/auth";

/**
 * Reads the access token from the gp_access httpOnly cookie.
 * (Previously read from Authorization: Bearer header — now cookie-based.)
 */
export async function getAuthUser(
  req: NextRequest
): Promise<TokenPayload | null> {
  const token = req.cookies.get(ACCESS_COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyToken(token);
}

/**
 * Reads the raw refresh token from the gp_refresh cookie, if present.
 */
export function getRefreshTokenFromReq(req: NextRequest): string | null {
  return req.cookies.get(REFRESH_COOKIE_NAME)?.value ?? null;
}

export function unauthorized() {
  return NextResponse.json({ error: "未授权" }, { status: 401 });
}

export function forbidden() {
  return NextResponse.json({ error: "无权限" }, { status: 403 });
}

export function success<T>(data: T, meta?: Record<string, unknown>) {
  return NextResponse.json({ success: true, data, ...meta });
}

export function error(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/** Safely parse a pagination parameter — returns default on NaN/invalid */
export function parsePage(value: string | null, defaultValue: number): number {
  const parsed = parseInt(value || String(defaultValue), 10);
  if (isNaN(parsed) || parsed < 1) return defaultValue;
  return parsed;
}

/** Safly parse pageSize, clamped to [1, maxPageSize] */
export function parsePageSize(value: string | null, defaultValue: number, maxPageSize = 100): number {
  const parsed = parseInt(value || String(defaultValue), 10);
  if (isNaN(parsed) || parsed < 1) return defaultValue;
  return Math.min(maxPageSize, parsed);
}

// BigInt serializer for JSON responses
export function serializeBigInt<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "bigint") return String(obj) as unknown as T;
  if (obj instanceof Date) return obj;
  if (Array.isArray(obj)) return obj.map(serializeBigInt) as unknown as T;
  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = serializeBigInt(value);
    }
    return result as T;
  }
  return obj;
}

// Convert snake_case keys to camelCase recursively
export function toCamelCase<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(toCamelCase) as unknown as T;
  if (typeof obj === "object" && !(obj instanceof Date)) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const camelKey = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
      result[camelKey] = toCamelCase(value);
    }
    return result as T;
  }
  return obj;
}
