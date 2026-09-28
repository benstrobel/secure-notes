// ECMA-376 / MS-OFFCRYPTO Agile Encryption -- the same AES-256 scheme Word
// itself uses for "Encrypt with Password". Built on the standard Web
// Crypto API (crypto.subtle), validated against an independent decoder
// (Python's msoffcrypto-tool + python-docx) before this ever ran in the app.
import { sha512 as sha512Sync } from "@noble/hashes/sha2.js";
import { concatBytes, le32, randomBytes, utf16leEncode, toBase64, fromBase64, bytesEqual } from "./bytes";

const BLOCK_KEY = {
  verifierHashInput: new Uint8Array([0xfe, 0xa7, 0xd2, 0x76, 0x3b, 0x4b, 0x9e, 0x79]),
  verifierHashValue: new Uint8Array([0xd7, 0xaa, 0x0f, 0x6d, 0x30, 0x61, 0x34, 0x4e]),
  keyValue: new Uint8Array([0x14, 0x6e, 0x0b, 0xe7, 0xab, 0xac, 0xd0, 0xd6]),
  hmacKey: new Uint8Array([0x5f, 0xb2, 0xad, 0x01, 0x0c, 0xb9, 0xe1, 0xf6]),
  hmacValue: new Uint8Array([0xa0, 0x67, 0x7f, 0x02, 0xb2, 0x2c, 0x84, 0x33]),
};

const SPIN_COUNT = 100_000;
const SEGMENT_LENGTH = 4096;

export class WrongPasswordError extends Error {
  constructor() {
    super("Incorrect password");
    this.name = "WrongPasswordError";
  }
}

async function sha512(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-512", data));
}

async function hmacSha512(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, data));
}

// Web Crypto's AES-CBC always PKCS7-pads/unpads; MS-OFFCRYPTO uses raw,
// unpadded CBC on data that's already block-aligned (16-byte multiples).
// Both helpers get NoPadding semantics out of WebCrypto's padded-only API:
// CBC ciphertext blocks only ever depend on the plaintext up to and
// including that block, never on what follows, so appending (and later
// discarding) one throwaway block around WebCrypto's mandatory padding
// doesn't change the real blocks' values.
async function aesEncryptNoPadding(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  if (data.length % 16 !== 0) throw new Error("aesEncryptNoPadding: input must be block-aligned");
  const cryptoKey = await crypto.subtle.importKey("raw", key, "AES-CBC", false, ["encrypt"]);
  const padded = concatBytes(data, new Uint8Array(16));
  const result = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-CBC", iv }, cryptoKey, padded));
  return result.slice(0, data.length);
}

async function aesDecryptNoPadding(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  if (data.length % 16 !== 0) throw new Error("aesDecryptNoPadding: input must be block-aligned");
  const cryptoKeyEnc = await crypto.subtle.importKey("raw", key, "AES-CBC", false, ["encrypt"]);
  const lastBlock = data.slice(data.length - 16);
  const pad = new Uint8Array(16).fill(16);
  const extra = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-CBC", iv: lastBlock }, cryptoKeyEnc, pad));
  const cryptoKeyDec = await crypto.subtle.importKey("raw", key, "AES-CBC", false, ["decrypt"]);
  const withPadBlock = concatBytes(data, extra.slice(0, 16));
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-CBC", iv }, cryptoKeyDec, withPadBlock));
}

// The spin-count loop below runs 100,000 sequential hashes (as Word itself
// does), each depending on the last. crypto.subtle.digest is async, and at
// this iteration count its per-call Promise/microtask overhead alone adds
// up to several seconds (measured ~7-8s) even though the actual hashing is
// fast -- a synchronous, audited pure-JS SHA-512 (@noble/hashes) avoids
// that overhead entirely and finishes in under a second. Every other hash
// in this file runs once, not 100,000 times, so it stays on crypto.subtle.
function deriveHFinalSync(passwordSalt: Uint8Array, password: string): Uint8Array {
  let h = sha512Sync(concatBytes(passwordSalt, utf16leEncode(password)));
  for (let i = 0; i < SPIN_COUNT; i++) {
    h = sha512Sync(concatBytes(le32(i), h));
  }
  return h;
}

async function blockKeyDerive(hFinal: Uint8Array, blockKey: Uint8Array, keyBytes: number): Promise<Uint8Array> {
  const full = await sha512(concatBytes(hFinal, blockKey));
  return full.slice(0, keyBytes);
}

// Same construction as blockKeyDerive, but for the dataIntegrity IVs: these
// are salted with keyDataSalt (not hFinal) and truncated to the block size
// (16), not the key size.
async function ivDerive(salt: Uint8Array, blockKey: Uint8Array): Promise<Uint8Array> {
  const full = await sha512(concatBytes(salt, blockKey));
  return full.slice(0, 16);
}

export interface AgileEncrypted {
  encryptionInfo: Uint8Array;
  encryptedPackage: Uint8Array;
}

export async function encryptAgile(password: string, plainPackage: Uint8Array): Promise<AgileEncrypted> {
  const passwordSalt = randomBytes(16);
  const keyDataSalt = randomBytes(16);
  const packageKey = randomBytes(32);
  const hFinal = deriveHFinalSync(passwordSalt, password);

  const verifierHashInput = randomBytes(16);
  const keyVerifierInput = await blockKeyDerive(hFinal, BLOCK_KEY.verifierHashInput, 32);
  const encryptedVerifierHashInput = await aesEncryptNoPadding(keyVerifierInput, passwordSalt, verifierHashInput);

  const verifierHashValue = await sha512(verifierHashInput);
  const keyVerifierValue = await blockKeyDerive(hFinal, BLOCK_KEY.verifierHashValue, 32);
  const encryptedVerifierHashValue = await aesEncryptNoPadding(keyVerifierValue, passwordSalt, verifierHashValue);

  const keyKeyValue = await blockKeyDerive(hFinal, BLOCK_KEY.keyValue, 32);
  const encryptedKeyValue = await aesEncryptNoPadding(keyKeyValue, passwordSalt, packageKey);

  // Document content: an 8-byte little-endian original-length prefix, then
  // AES-256-CBC over 4096-byte segments (each with its own derived IV).
  const lengthPrefix = new Uint8Array(8);
  new DataView(lengthPrefix.buffer).setBigUint64(0, BigInt(plainPackage.length), true);

  const segments: Uint8Array[] = [];
  for (let offset = 0; offset < plainPackage.length; offset += SEGMENT_LENGTH) {
    let segment = plainPackage.slice(offset, offset + SEGMENT_LENGTH);
    const segmentIndex = offset / SEGMENT_LENGTH;
    const iv = (await sha512(concatBytes(keyDataSalt, le32(segmentIndex)))).slice(0, 16);
    if (segment.length % 16 !== 0) {
      const padded = new Uint8Array(Math.ceil(segment.length / 16) * 16);
      padded.set(segment);
      segment = padded;
    }
    segments.push(await aesEncryptNoPadding(packageKey, iv, segment));
  }
  const encryptedPackage = concatBytes(lengthPrefix, ...segments);

  // HMAC over the encrypted package, for the dataIntegrity element. Per
  // MS-OFFCRYPTO 2.3.4.14, the HMAC key/value are encrypted with the
  // package's own secret key (not a password-derived key), with IVs derived
  // from keyDataSalt -- so verifying integrity doesn't require redoing the
  // (expensive) password-based key derivation.
  const hmacKey = randomBytes(64);
  const hmacValue = await hmacSha512(hmacKey, encryptedPackage);
  const hmacKeyIv = await ivDerive(keyDataSalt, BLOCK_KEY.hmacKey);
  const encryptedHmacKey = await aesEncryptNoPadding(packageKey, hmacKeyIv, hmacKey);
  const hmacValueIv = await ivDerive(keyDataSalt, BLOCK_KEY.hmacValue);
  const encryptedHmacValue = await aesEncryptNoPadding(packageKey, hmacValueIv, hmacValue);

  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<encryption xmlns="http://schemas.microsoft.com/office/2006/encryption" xmlns:p="http://schemas.microsoft.com/office/2006/keyEncryptor/password">
<keyData saltSize="16" blockSize="16" keyBits="256" hashSize="64" cipherAlgorithm="AES" cipherChaining="ChainingModeCBC" hashAlgorithm="SHA512" saltValue="${toBase64(keyDataSalt)}"/>
<dataIntegrity encryptedHmacKey="${toBase64(encryptedHmacKey)}" encryptedHmacValue="${toBase64(encryptedHmacValue)}"/>
<keyEncryptors>
<keyEncryptor uri="http://schemas.microsoft.com/office/2006/keyEncryptor/password">
<p:encryptedKey spinCount="${SPIN_COUNT}" saltSize="16" blockSize="16" keyBits="256" hashSize="64" cipherAlgorithm="AES" cipherChaining="ChainingModeCBC" hashAlgorithm="SHA512" saltValue="${toBase64(passwordSalt)}" encryptedVerifierHashInput="${toBase64(encryptedVerifierHashInput)}" encryptedVerifierHashValue="${toBase64(encryptedVerifierHashValue)}" encryptedKeyValue="${toBase64(encryptedKeyValue)}"/>
</keyEncryptor>
</keyEncryptors>
</encryption>`;

  const versionAndFlags = new Uint8Array([0x04, 0x00, 0x04, 0x00, 0x40, 0x00, 0x00, 0x00]);
  const encryptionInfo = concatBytes(versionAndFlags, utf8Encode(xml));

  return { encryptionInfo, encryptedPackage };
}

function utf8Encode(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function xmlAttr(xml: string, tag: string, name: string): string {
  const tagMatch = xml.match(new RegExp(`<[\\w:]*${tag}[\\s\\S]*?/>`));
  if (!tagMatch) throw new Error(`EncryptionInfo XML missing <${tag}>`);
  const m = tagMatch[0].match(new RegExp(`${name}="([^"]*)"`));
  if (!m) throw new Error(`EncryptionInfo XML: <${tag}> missing ${name}`);
  return m[1];
}

/** @throws WrongPasswordError if `password` does not unlock this file. */
export async function decryptAgile(password: string, encryptionInfo: Uint8Array, encryptedPackage: Uint8Array): Promise<Uint8Array> {
  const xml = new TextDecoder().decode(encryptionInfo.slice(8));

  const passwordSalt = fromBase64(xmlAttr(xml, "encryptedKey", "saltValue"));
  const encryptedKeyValue = fromBase64(xmlAttr(xml, "encryptedKey", "encryptedKeyValue"));
  const encryptedVerifierHashInput = fromBase64(xmlAttr(xml, "encryptedKey", "encryptedVerifierHashInput"));
  const encryptedVerifierHashValue = fromBase64(xmlAttr(xml, "encryptedKey", "encryptedVerifierHashValue"));
  const keyDataSalt = fromBase64(xmlAttr(xml, "keyData", "saltValue"));

  const hFinal = deriveHFinalSync(passwordSalt, password);

  const keyVerifierInput = await blockKeyDerive(hFinal, BLOCK_KEY.verifierHashInput, 32);
  const verifierHashInput = await aesDecryptNoPadding(keyVerifierInput, passwordSalt, encryptedVerifierHashInput);
  const keyVerifierValue = await blockKeyDerive(hFinal, BLOCK_KEY.verifierHashValue, 32);
  const verifierHashValue = await aesDecryptNoPadding(keyVerifierValue, passwordSalt, encryptedVerifierHashValue);
  const expectedHash = await sha512(verifierHashInput);
  if (!bytesEqual(expectedHash, verifierHashValue)) throw new WrongPasswordError();

  const keyKeyValue = await blockKeyDerive(hFinal, BLOCK_KEY.keyValue, 32);
  const packageKey = await aesDecryptNoPadding(keyKeyValue, passwordSalt, encryptedKeyValue);

  const originalLength = Number(new DataView(encryptedPackage.buffer, encryptedPackage.byteOffset, 8).getBigUint64(0, true));
  const cipherBody = encryptedPackage.slice(8);
  const plainSegments: Uint8Array[] = [];
  for (let offset = 0; offset < cipherBody.length; offset += SEGMENT_LENGTH) {
    const segment = cipherBody.slice(offset, offset + SEGMENT_LENGTH);
    const segmentIndex = offset / SEGMENT_LENGTH;
    const iv = (await sha512(concatBytes(keyDataSalt, le32(segmentIndex)))).slice(0, 16);
    plainSegments.push(await aesDecryptNoPadding(packageKey, iv, segment));
  }
  return concatBytes(...plainSegments).slice(0, originalLength);
}
