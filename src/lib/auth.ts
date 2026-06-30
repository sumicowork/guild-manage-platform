import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";

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

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function signToken(payload: TokenPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(jwtSecret());
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
