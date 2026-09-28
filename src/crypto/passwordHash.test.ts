import { describe, it, expect } from "vitest";
import { createVerifier, verifyPassword, deriveKeyBytes } from "./passwordHash";
import { randomBytes } from "./bytes";

describe("passwordHash", () => {
  it("matches the correct password", async () => {
    const verifier = await createVerifier("hunter2", 10_000);
    expect(await verifyPassword("hunter2", verifier)).toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const verifier = await createVerifier("hunter2", 10_000);
    expect(await verifyPassword("hunter3", verifier)).toBe(false);
  });

  it("uses a fresh random salt each time", async () => {
    const a = await createVerifier("same-password", 10_000);
    const b = await createVerifier("same-password", 10_000);
    expect(a.saltBase64).not.toBe(b.saltBase64);
    expect(a.hashBase64).not.toBe(b.hashBase64);
  });

  it("derive is deterministic for the same salt and iterations", async () => {
    const salt = randomBytes(16);
    const key1 = await deriveKeyBytes("hunter2", salt, 10_000, 256);
    const key2 = await deriveKeyBytes("hunter2", salt, 10_000, 256);
    expect(key1).toEqual(key2);
  });
});
