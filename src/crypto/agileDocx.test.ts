import { describe, it, expect } from "vitest";
import { encryptAgile, decryptAgile, WrongPasswordError } from "./agileDocx";
import { buildDocxPackage, parseDocxPackage } from "./docxPackage";

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
});
