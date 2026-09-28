import { describe, it, expect } from "vitest";
import { sha512 as sha512Sync } from "@noble/hashes/sha2.js";
import { encryptAgile, decryptAgile, WrongPasswordError } from "./agileDocx";
import { buildDocxPackage, parseDocxPackage } from "./docxPackage";
import { concatBytes, fromBase64, le32, utf16leEncode } from "./bytes";

/**
 * These are pure round-trip tests against our own encrypt/decrypt. The
 * real proof this produces Word-compatible output is external: the exact
 * same algorithm was cross-checked during development against an
 * independent decoder (Python's msoffcrypto-tool + python-docx), which
 * successfully decrypted a file produced by this code and read the right
 * content back out, and correctly rejected a wrong password. See the
 * project README for details.
 */
describe("agile docx encryption", () => {
  it("round trips title and body with the correct password", async () => {
    const pkg = await buildDocxPackage("My Diary Entry", "Line one\nLine two\nUnicode: äöü ✔");
    const { encryptionInfo, encryptedPackage } = await encryptAgile("correct-horse-battery", pkg);

    const decryptedPkg = await decryptAgile("correct-horse-battery", encryptionInfo, encryptedPackage);
    const content = await parseDocxPackage(decryptedPkg);

    expect(content.title).toBe("My Diary Entry");
    expect(content.body).toBe("Line one\nLine two\nUnicode: äöü ✔");
  });

  it("rejects a wrong password", async () => {
    const pkg = await buildDocxPackage("Title", "Body");
    const { encryptionInfo, encryptedPackage } = await encryptAgile("right-password", pkg);

    await expect(decryptAgile("wrong-password", encryptionInfo, encryptedPackage)).rejects.toThrow(WrongPasswordError);
  });

  it("handles an empty body", async () => {
    const pkg = await buildDocxPackage("Empty note", "");
    const { encryptionInfo, encryptedPackage } = await encryptAgile("pw", pkg);
    const decryptedPkg = await decryptAgile("pw", encryptionInfo, encryptedPackage);
    const content = await parseDocxPackage(decryptedPkg);
    expect(content.title).toBe("Empty note");
    expect(content.body).toBe("");
  });

  it("handles xml special characters", async () => {
    const body = `5 < 10 && 10 > 5 "quoted" 'apostrophe' & ampersand`;
    const pkg = await buildDocxPackage("Special <chars>", body);
    const { encryptionInfo, encryptedPackage } = await encryptAgile("pw", pkg);
    const decryptedPkg = await decryptAgile("pw", encryptionInfo, encryptedPackage);
    const content = await parseDocxPackage(decryptedPkg);
    expect(content.title).toBe("Special <chars>");
    expect(content.body).toBe(body);
  });

  it("handles content spanning multiple 4096-byte segments", async () => {
    const longLine = "x".repeat(9000);
    const pkg = await buildDocxPackage("Long note", longLine);
    const { encryptionInfo, encryptedPackage } = await encryptAgile("pw", pkg);
    const decryptedPkg = await decryptAgile("pw", encryptionInfo, encryptedPackage);
    const content = await parseDocxPackage(decryptedPkg);
    expect(content.body).toBe(longLine);
  });

  /**
   * Regression test for a real bug: the dataIntegrity HMAC key/value were
   * encrypted with the wrong key/IV (password-derived, like the verifier
   * hashes), instead of the package's own secret key with a keyDataSalt-
   * derived IV, per MS-OFFCRYPTO 2.3.4.14. `decryptAgile` never checks this
   * element, so the bug was invisible to plain round-trip tests -- but Word
   * *does* check it on open, and rejected every file with a "may have been
   * tampered with or corrupted" warning. This independently re-derives the
   * HMAC per spec, the same way Word/msoffcrypto-tool do, and was confirmed
   * against msoffcrypto-tool's `decrypt(..., verify_integrity=True)` during
   * development (see README).
   */
  it("produces a dataIntegrity HMAC that verifies per MS-OFFCRYPTO 2.3.4.14", async () => {
    const password = "correct-horse-battery";
    const pkg = await buildDocxPackage("Title", "Body");
    const { encryptionInfo, encryptedPackage } = await encryptAgile(password, pkg);
    const xml = new TextDecoder().decode(encryptionInfo.slice(8));

    const passwordSalt = fromBase64(xmlAttr(xml, "encryptedKey", "saltValue"));
    const encryptedKeyValue = fromBase64(xmlAttr(xml, "encryptedKey", "encryptedKeyValue"));
    const keyDataSalt = fromBase64(xmlAttr(xml, "keyData", "saltValue"));
    const encryptedHmacKey = fromBase64(xmlAttr(xml, "dataIntegrity", "encryptedHmacKey"));
    const encryptedHmacValue = fromBase64(xmlAttr(xml, "dataIntegrity", "encryptedHmacValue"));

    const hFinal = deriveHFinalSync(passwordSalt, password);
    const packageKey = await aesDecryptNoPadding(
      await blockKeyDerive(hFinal, BLOCK_KEY_ENCRYPTED_KEY_VALUE, 32),
      passwordSalt,
      encryptedKeyValue,
    );

    const hmacKey = await aesDecryptNoPadding(packageKey, await ivDerive(keyDataSalt, BLOCK_KEY_HMAC_KEY), encryptedHmacKey);
    const hmacValue = await aesDecryptNoPadding(packageKey, await ivDerive(keyDataSalt, BLOCK_KEY_HMAC_VALUE), encryptedHmacValue);

    const cryptoKey = await crypto.subtle.importKey("raw", hmacKey, { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
    const actualHmac = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, encryptedPackage));

    expect(actualHmac).toEqual(hmacValue);
  });
});

// -- Independent re-implementation of the parts of MS-OFFCRYPTO needed to
// verify the dataIntegrity HMAC above, deliberately not reusing agileDocx.ts
// internals, so this test can't pass merely because it shares a bug with
// the code under test.

const BLOCK_KEY_ENCRYPTED_KEY_VALUE = new Uint8Array([0x14, 0x6e, 0x0b, 0xe7, 0xab, 0xac, 0xd0, 0xd6]);
const BLOCK_KEY_HMAC_KEY = new Uint8Array([0x5f, 0xb2, 0xad, 0x01, 0x0c, 0xb9, 0xe1, 0xf6]);
const BLOCK_KEY_HMAC_VALUE = new Uint8Array([0xa0, 0x67, 0x7f, 0x02, 0xb2, 0x2c, 0x84, 0x33]);
const SPIN_COUNT = 100_000;

function xmlAttr(xml: string, tag: string, name: string): string {
  const tagMatch = xml.match(new RegExp(`<[\\w:]*${tag}[\\s\\S]*?/>`));
  if (!tagMatch) throw new Error(`EncryptionInfo XML missing <${tag}>`);
  const m = tagMatch[0].match(new RegExp(`${name}="([^"]*)"`));
  if (!m) throw new Error(`EncryptionInfo XML: <${tag}> missing ${name}`);
  return m[1];
}

function deriveHFinalSync(passwordSalt: Uint8Array, password: string): Uint8Array {
  let h = sha512Sync(concatBytes(passwordSalt, utf16leEncode(password)));
  for (let i = 0; i < SPIN_COUNT; i++) {
    h = sha512Sync(concatBytes(le32(i), h));
  }
  return h;
}

async function blockKeyDerive(hFinal: Uint8Array, blockKey: Uint8Array, keyBytes: number): Promise<Uint8Array> {
  const full = new Uint8Array(await crypto.subtle.digest("SHA-512", concatBytes(hFinal, blockKey)));
  return full.slice(0, keyBytes);
}

async function ivDerive(salt: Uint8Array, blockKey: Uint8Array): Promise<Uint8Array> {
  const full = new Uint8Array(await crypto.subtle.digest("SHA-512", concatBytes(salt, blockKey)));
  return full.slice(0, 16);
}

async function aesDecryptNoPadding(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const cryptoKeyEnc = await crypto.subtle.importKey("raw", key, "AES-CBC", false, ["encrypt"]);
  const lastBlock = data.slice(data.length - 16);
  const pad = new Uint8Array(16).fill(16);
  const extra = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-CBC", iv: lastBlock }, cryptoKeyEnc, pad));
  const cryptoKeyDec = await crypto.subtle.importKey("raw", key, "AES-CBC", false, ["decrypt"]);
  const withPadBlock = concatBytes(data, extra.slice(0, 16));
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-CBC", iv }, cryptoKeyDec, withPadBlock));
}
