import { describe, it, expect } from "vitest";
import { encryptGcm, decryptGcm } from "./metadataCipher";
import { deriveKeyBytes } from "./passwordHash";
import { randomBytes } from "./bytes";

describe("metadataCipher", () => {
  it("round trips plaintext with the correct key", async () => {
    const key = await deriveKeyBytes("hunter2", randomBytes(16), 10_000, 256);
    const plaintext = new TextEncoder().encode('[{"id":"1","title":"hello"}]');

    const ciphertext = await encryptGcm(plaintext, key);
    const decrypted = await decryptGcm(ciphertext, key);

    expect(decrypted).toEqual(plaintext);
  });

  it("rejects the wrong key", async () => {
    const key = await deriveKeyBytes("hunter2", randomBytes(16), 10_000, 256);
    const wrongKey = await deriveKeyBytes("hunter3", randomBytes(16), 10_000, 256);
    const ciphertext = await encryptGcm(new TextEncoder().encode("secret data"), key);

    await expect(decryptGcm(ciphertext, wrongKey)).rejects.toThrow();
  });

  it("uses a fresh random iv each time", async () => {
    const key = await deriveKeyBytes("hunter2", randomBytes(16), 10_000, 256);
    const plaintext = new TextEncoder().encode("same plaintext");
    const a = await encryptGcm(plaintext, key);
    const b = await encryptGcm(plaintext, key);
    expect(a).not.toEqual(b);
  });
});
