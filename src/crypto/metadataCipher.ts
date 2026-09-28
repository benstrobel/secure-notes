// AES-256-GCM encryption for the small local metadata index (folder tree,
// note titles/timestamps/Drive file ids). Notes themselves are protected
// as real password-protected .docx files (agileDocx.ts); this covers the
// one other local file the app writes, so it's never stored in the clear.
import { concatBytes, randomBytes } from "./bytes";

const IV_LENGTH_BYTES = 12;
const TAG_LENGTH_BITS = 128;

export async function encryptGcm(plaintext: Uint8Array, key: Uint8Array): Promise<Uint8Array> {
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cryptoKey = await crypto.subtle.importKey("raw", key, "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, tagLength: TAG_LENGTH_BITS }, cryptoKey, plaintext));
  return concatBytes(iv, ciphertext);
}

/** @throws if `key` is wrong or `data` was tampered with/corrupted (GCM tag check fails). */
export async function decryptGcm(data: Uint8Array, key: Uint8Array): Promise<Uint8Array> {
  if (data.length <= IV_LENGTH_BYTES) throw new Error("Data too short to contain an IV");
  const iv = data.slice(0, IV_LENGTH_BYTES);
  const ciphertext = data.slice(IV_LENGTH_BYTES);
  const cryptoKey = await crypto.subtle.importKey("raw", key, "AES-GCM", false, ["decrypt"]);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv, tagLength: TAG_LENGTH_BITS }, cryptoKey, ciphertext);
  return new Uint8Array(plaintext);
}
