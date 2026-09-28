// Combines the pieces into "encrypt a note to real .docx bytes" / "decrypt
// real .docx bytes back to a note" -- the OLE2/CFB container (via the
// well-tested `cfb` library) wrapping ECMA-376 Agile Encryption (agileDocx.ts)
// wrapping a minimal WordprocessingML package (docxPackage.ts).
import * as CFB from "cfb";
import { buildDocxPackage, parseDocxPackage, type DocxContent } from "./docxPackage";
import { encryptAgile, decryptAgile } from "./agileDocx";

export async function encryptDocxFile(password: string, title: string, body: string): Promise<Uint8Array> {
  const plainPackage = await buildDocxPackage(title, body);
  const { encryptionInfo, encryptedPackage } = await encryptAgile(password, plainPackage);

  const cfb = CFB.utils.cfb_new();
  CFB.utils.cfb_add(cfb, "EncryptionInfo", encryptionInfo);
  CFB.utils.cfb_add(cfb, "EncryptedPackage", encryptedPackage);
  return CFB.write(cfb, { type: "array" }) as Uint8Array;
}

/** @throws WrongPasswordError (from agileDocx.ts) if `password` is wrong, or a generic error if `fileBytes` isn't a valid encrypted docx. */
export async function decryptDocxFile(password: string, fileBytes: Uint8Array): Promise<DocxContent> {
  const cfb = CFB.read(fileBytes, { type: "array" });
  const encryptionInfo = CFB.find(cfb, "EncryptionInfo")?.content;
  const encryptedPackage = CFB.find(cfb, "EncryptedPackage")?.content;
  if (!encryptionInfo || !encryptedPackage) throw new Error("Not a recognized encrypted .docx file");

  const plainPackage = await decryptAgile(password, new Uint8Array(encryptionInfo), new Uint8Array(encryptedPackage));
  return parseDocxPackage(plainPackage);
}
