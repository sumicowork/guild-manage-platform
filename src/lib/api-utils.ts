import { NextRequest, NextResponse } from "next/server";
import { verifyToken, TokenPayload } from "@/lib/auth";

export async function getAuthUser(
  req: NextRequest
): Promise<TokenPayload | null> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  return verifyToken(token);
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

// BigInt serializer for JSON responses
export function serializeBigInt<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "bigint") return String(obj) as unknown as T;
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
