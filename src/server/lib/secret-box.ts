import { env } from "cloudflare:workers";

// AES-GCM for secrets stored in the database, keyed from BETTER_AUTH_SECRET.
// Rotating that secret makes stored values unreadable, which surfaces as
// "re-enter your key" instead of a silent wrong answer.
const encoder = new TextEncoder();

async function deriveKey(): Promise<CryptoKey> {
  const secret = env.BETTER_AUTH_SECRET?.trim();
  if (!secret) throw new Error("BETTER_AUTH_SECRET is required");
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: encoder.encode("caldrin-workspace-credentials"),
      info: encoder.encode("v1"),
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function toBase64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(value: string) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

export async function sealSecret(plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      await deriveKey(),
      encoder.encode(plaintext),
    ),
  );
  return `${toBase64(iv)}.${toBase64(cipher)}`;
}

export async function openSecret(sealed: string): Promise<string | null> {
  const [iv, cipher] = sealed.split(".");
  if (!iv || !cipher) return null;
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(iv) },
      await deriveKey(),
      fromBase64(cipher),
    );
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}
