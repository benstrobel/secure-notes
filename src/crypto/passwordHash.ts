// PBKDF2-based password verifier, used only to give a fast "wrong
// password" error at the unlock screen without touching any note file.
// Also used to derive symmetric keys elsewhere (with different salts).
import { randomBytes, toBase64, fromBase64, bytesEqual } from "./bytes";

export const DEFAULT_ITERATIONS = 210_000;
const SALT_LENGTH_BYTES = 16;

export interface Verifier {
  saltBase64: string;
  hashBase64: string;
  iterations: number;
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number, keyLengthBits: number): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, keyMaterial, keyLengthBits);
  return new Uint8Array(bits);
}

export async function createVerifier(password: string, iterations: number = DEFAULT_ITERATIONS): Promise<Verifier> {
  const salt = randomBytes(SALT_LENGTH_BYTES);
  const hash = await pbkdf2(password, salt, iterations, 256);
  return { saltBase64: toBase64(salt), hashBase64: toBase64(hash), iterations };
}

export async function verifyPassword(password: string, verifier: Verifier): Promise<boolean> {
  const salt = fromBase64(verifier.saltBase64);
  const expected = fromBase64(verifier.hashBase64);
  const actual = await pbkdf2(password, salt, verifier.iterations, expected.length * 8);
  return bytesEqual(expected, actual);
}

/** Derives raw key bytes of `keyLengthBits` from `password` + `salt` -- for deriving a symmetric key, not for verification. */
export async function deriveKeyBytes(password: string, salt: Uint8Array, iterations: number, keyLengthBits: number): Promise<Uint8Array> {
  return pbkdf2(password, salt, iterations, keyLengthBits);
}
