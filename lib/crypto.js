// ─────────────────────────────────────────────────────────────────────────────
// AES-256-GCM encryption for API keys stored in the database.
//
// Requires env var: ENCRYPTION_KEY — a 64-character hex string (32 bytes).
// Generate one with:  openssl rand -hex 32
// ─────────────────────────────────────────────────────────────────────────────
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";

function getKey() {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      "ENCRYPTION_KEY env var must be a 64-char hex string (32 bytes). " +
      "Generate one with: openssl rand -hex 32"
    );
  }
  return Buffer.from(hex, "hex");
}

// Returns a base64 string: iv (12 bytes) + auth tag (16 bytes) + ciphertext
export function encrypt(plaintext) {
  const key = getKey();
  const iv  = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

// Accepts the base64 string produced by encrypt()
export function decrypt(ciphertext) {
  const key = getKey();
  const buf = Buffer.from(ciphertext, "base64");
  const iv        = buf.subarray(0, 12);
  const tag       = buf.subarray(12, 28);
  const encrypted = buf.subarray(28);
  const decipher  = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}
