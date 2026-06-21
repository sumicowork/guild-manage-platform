import crypto from "crypto";

const ALGORITHM = "aes-256-cbc";

/**
 * 从 ENCRYPT_KEY 派生 32 字节 AES-256 密钥。
 *
 * 使用 SHA-256 保证任何长度的输入都产生正好 32 字节，
 * 避免 Buffer.from + padEnd 在不同运行时环境中产生错误长度。
 */
function deriveKey(): Buffer {
  const raw = process.env.ENCRYPT_KEY || "0123456789abcdef0123456789abcdef";
  return crypto.createHash("sha256").update(raw, "utf-8").digest();
}

export function encrypt(text: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, deriveKey(), iv);
  let encrypted = cipher.update(text, "utf-8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted;
}

export function decrypt(encryptedText: string): string {
  const [ivHex, encrypted] = encryptedText.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, deriveKey(), iv);
  let decrypted = decipher.update(encrypted, "hex", "utf-8");
  decrypted += decipher.final("utf-8");
  return decrypted;
}
