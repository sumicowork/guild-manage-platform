import bcrypt from "bcryptjs";
import crypto from "crypto";
import { SignJWT, jwtVerify } from "jose";
import { prisma } from "@/lib/db";

function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET env var is required — refusing to start with no secret");
  }
  return new TextEncoder().encode(secret);
}

// Lazy-init: only read env at first use (not at module load, so tests can set env)
let _jwtSecret: Uint8Array | null = null;
function jwtSecret(): Uint8Array {
  if (!_jwtSecret) _jwtSecret = getJwtSecret();
  return _jwtSecret;
}

export interface TokenPayload {
  userId: number;
  username: string;
  role: string;
}

// ─── Access Token (short-lived JWT, 15 min) ─────────────────────────

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function signAccessToken(payload: TokenPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(jwtSecret());
}

/** Legacy alias — now signs a short-lived access token */
export async function signToken(payload: TokenPayload): Promise<string> {
  return signAccessToken(payload);
}

export async function verifyToken(token: string): Promise<TokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, jwtSecret());
    return {
      userId: Number(payload.userId),
      username: String(payload.username ?? ""),
      role: String(payload.role ?? "operator"),
    };
  } catch {
    // Token expired, invalid signature, or malformed — treat all as unauthenticated
    return null;
  }
}

// ─── Refresh Token (opaque, hashed in DB, 7 days) ───────────────────

const REFRESH_TOKEN_BYTES = 48; // 384 bits of entropy
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function hashRefreshToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

/**
 * Issues a new refresh token, persists its hash to DB, returns the raw token
 * (only seen once by the caller — to be set as httpOnly cookie).
 */
export async function issueRefreshToken(userId: bigint): Promise<string> {
  const raw = crypto.randomBytes(REFRESH_TOKEN_BYTES).toString("base64url");
  const hash = hashRefreshToken(raw);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

  await prisma.refreshToken.create({
    data: {
      token_hash: hash,
      user_id: userId,
      expires_at: expiresAt,
    },
  });

  return raw;
}

/**
 * Validates a raw refresh token against DB. Returns the user ID if valid & not
 * revoked & not expired, otherwise null.
 */
export async function verifyRefreshToken(
  rawToken: string
): Promise<bigint | null> {
  const hash = hashRefreshToken(rawToken);
  const record = await prisma.refreshToken.findUnique({
    where: { token_hash: hash },
  });
  if (!record) return null;
  if (record.revoked_at !== null) return null;
  if (record.expires_at.getTime() < Date.now()) return null;
  return record.user_id;
}

/**
 * Rotates a refresh token: revokes the old one, issues a new one.
 * Returns [newRawToken, userId] on success, or null if old token invalid.
 *
 * Rotation defeats reuse: a stolen refresh token becomes invalid after legit use.
 */
export async function rotateRefreshToken(
  oldRawToken: string
): Promise<[string, bigint] | null> {
  const hash = hashRefreshToken(oldRawToken);
  const record = await prisma.refreshToken.findUnique({
    where: { token_hash: hash },
  });
  if (!record) return null;
  if (record.revoked_at !== null) return null;
  if (record.expires_at.getTime() < Date.now()) return null;

  // Revoke old + issue new in a transaction
  const userId = record.user_id;
  const newRaw = crypto.randomBytes(REFRESH_TOKEN_BYTES).toString("base64url");
  const newHash = hashRefreshToken(newRaw);
  const newExpires = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

  await prisma.$transaction([
    prisma.refreshToken.update({
      where: { id: record.id },
      data: { revoked_at: new Date() },
    }),
    prisma.refreshToken.create({
      data: {
        token_hash: newHash,
        user_id: userId,
        expires_at: newExpires,
      },
    }),
  ]);

  return [newRaw, userId];
}

/**
 * Revokes all refresh tokens for a user (used at logout).
 */
export async function revokeAllUserRefreshTokens(userId: bigint): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { user_id: userId, revoked_at: null },
    data: { revoked_at: new Date() },
  });
}

// ─── Cookie helpers ──────────────────────────────────────────────────

const ACCESS_COOKIE = "gp_access";
const REFRESH_COOKIE = "gp_refresh";

function isProd(): boolean {
  return process.env.NODE_ENV === "production";
}

interface CookieOptions {
  maxAgeSeconds: number;
  httpOnly?: boolean;
  sameSite?: "strict" | "lax" | "none";
}

function buildCookie(
  name: string,
  value: string,
  opts: CookieOptions
): string {
  const parts: string[] = [
    `${name}=${value}`,
    "Path=/",
    `Max-Age=${opts.maxAgeSeconds}`,
    "HttpOnly",
    `SameSite=${opts.sameSite ?? "strict"}`,
  ];
  if (isProd()) parts.push("Secure");
  return parts.join("; ");
}

function buildClearCookie(name: string): string {
  const parts: string[] = [`${name}=`, "Path=/", "Max-Age=0", "HttpOnly", "SameSite=strict"];
  if (isProd()) parts.push("Secure");
  return parts.join("; ");
}

const ACCESS_TTL_S = 15 * 60; // 15 min, matches JWT exp
const REFRESH_TTL_S = 7 * 24 * 60 * 60; // 7 days

export function buildAccessCookie(token: string): string {
  return buildCookie(ACCESS_COOKIE, token, { maxAgeSeconds: ACCESS_TTL_S });
}

export function buildRefreshCookie(token: string): string {
  return buildCookie(REFRESH_COOKIE, token, {
    maxAgeSeconds: REFRESH_TTL_S,
    sameSite: "strict",
  });
}

export function buildClearAccessCookie(): string {
  return buildClearCookie(ACCESS_COOKIE);
}

export function buildClearRefreshCookie(): string {
  return buildClearCookie(REFRESH_COOKIE);
}

export const ACCESS_COOKIE_NAME = ACCESS_COOKIE;
export const REFRESH_COOKIE_NAME = REFRESH_COOKIE;
