import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // GCM standard IV length
const TAG_LENGTH = 16;

/**
 * 从 ENCRYPT_KEY 派生 32 字节 AES-256 密钥。
 * 缺失时抛错（fail-fast），绝不使用默认值。
 */
function deriveKey(): Buffer {
  const raw = process.env.ENCRYPT_KEY;
  if (!raw) {
    throw new Error("ENCRYPT_KEY env var is required — refusing to start with no encryption key");
  }
  return crypto.createHash("sha256").update(raw, "utf-8").digest();
}

export function encrypt(text: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, deriveKey(), iv);
  let encrypted = cipher.update(text, "utf-8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag();
  // format: iv:tag:ciphertext  (all hex)
  return iv.toString("hex") + ":" + tag.toString("hex") + ":" + encrypted;
}

export function decrypt(encryptedText: string): string {
  // Support both new GCM format (iv:tag:ciphertext) and legacy CBC format (iv:ciphertext)
  const parts = encryptedText.split(":");
  if (parts.length === 3) {
    // GCM format
  const [ivHex, tagHex, encrypted] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, deriveKey(), iv);
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(encrypted, "hex", "utf-8");
  decrypted += decipher.final("utf-8");
  return decrypted;
  } else if (parts.length === 2) {
    // Legacy CBC format (backwards compat with previously stored tokens)
    const [ivHex, encrypted] = parts;
    const iv = Buffer.from(ivHex, "hex");
    const decipher = crypto.createDecipheriv("aes-256-cbc", deriveKey(), iv);
    let decrypted = decipher.update(encrypted, "hex", "utf-8");
    decrypted += decipher.final("utf-8");
    return decrypted;
  } else {
    throw new Error("Invalid ciphertext format: expected iv:tag:ciphertext or iv:ciphertext");
  }
}
