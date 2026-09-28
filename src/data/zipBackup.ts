// Whole-vault backup as a zip: since only files this app itself creates
// are visible to it in Drive (drive.file scope), this is the real
// disaster-recovery path -- if Drive access is ever lost, download the
// Drive folder as a zip (Drive's own "Download" button does this) and
// import it here. Each .docx inside stays exactly as encrypted as it was
// on disk/Drive; export never needs to decrypt note bodies, only read the
// (already-unlocked) index to know each note's folder path and filename.
import JSZip from "jszip";
import { dbGet, dbPut, NOTES_STORE } from "./db";
import * as vault from "./vault";
import { decryptDocxFile } from "../crypto/docxFile";
import { fileNameFor, DAILY_ID_PATTERN } from "./notes";
import { ROOT_FOLDER_ID, type VaultIndex } from "./types";

export async function exportVaultZip(): Promise<Blob> {
  const index = await vault.loadIndex();
  const zip = new JSZip();

  function pathFor(folderId: string): string {
    if (folderId === ROOT_FOLDER_ID) return "";
    const folder = index.folders.find((f) => f.id === folderId);
    if (!folder) return "";
    const parentPath = pathFor(folder.parentId);
    return parentPath ? `${parentPath}/${folder.name}` : folder.name;
  }

  for (const meta of index.notes) {
    const bytes = await dbGet<Uint8Array>(NOTES_STORE, meta.id);
    if (!bytes) continue;
    const folderPath = pathFor(meta.folderId);
    const fullPath = folderPath ? `${folderPath}/${fileNameFor(meta)}` : fileNameFor(meta);
    zip.file(fullPath, bytes);
  }

  return zip.generateAsync({ type: "blob" });
}

export interface ImportResult {
  imported: number;
  skipped: number;
}

/**
 * Imports every `.docx` found in `zipBytes` (an export from this app, or a
 * zip you made yourself of a Drive folder) that decrypts with `password`.
 * Reconstructs the zip's folder structure locally. Meant for restoring
 * into an empty or partially-empty vault: a daily note whose id (its
 * filename) already exists locally is skipped to avoid a duplicate, but a
 * regular note has no stable id to match against re-imports by, so
 * re-importing a zip that overlaps an already-populated vault can create
 * duplicates for non-daily notes.
 */
export async function importVaultZip(zipBytes: Uint8Array, password: string): Promise<ImportResult> {
  const zip = await JSZip.loadAsync(zipBytes);
  const index: VaultIndex = await vault.loadIndex();
  let imported = 0;
  let skipped = 0;

  const pathToFolderId = new Map<string, string>([["", ROOT_FOLDER_ID]]);
  function ensureLocalFolderPath(pathParts: string[]): string {
    let parentId = ROOT_FOLDER_ID;
    let pathSoFar = "";
    for (const part of pathParts) {
      pathSoFar = pathSoFar ? `${pathSoFar}/${part}` : part;
      let id = pathToFolderId.get(pathSoFar);
      if (!id) {
        let existing = index.folders.find((f) => f.parentId === parentId && f.name === part);
        if (!existing) {
          existing = { id: crypto.randomUUID(), name: part, parentId };
          index.folders.push(existing);
        }
        id = existing.id;
        pathToFolderId.set(pathSoFar, id);
      }
      parentId = id;
    }
    return parentId;
  }

  const entries = Object.values(zip.files).filter((f) => !f.dir && f.name.toLowerCase().endsWith(".docx"));
  for (const entry of entries) {
    const parts = entry.name.split("/").filter((p) => p.length > 0);
    const fileName = parts.pop();
    if (!fileName) continue;
    const bytes = await entry.async("uint8array");

    let content;
    try {
      content = await decryptDocxFile(password, bytes);
    } catch {
      skipped++;
      continue;
    }

    const dailyMatch = fileName.match(/^(\d{4}-\d{2}-\d{2})\.docx$/i);
    const id = dailyMatch ? dailyMatch[1] : crypto.randomUUID();
    if (DAILY_ID_PATTERN.test(id) && index.notes.some((n) => n.id === id)) {
      skipped++;
      continue;
    }

    const folderId = ensureLocalFolderPath(parts);
    await dbPut(NOTES_STORE, id, bytes);
    const now = Date.now();
    index.notes.push({ id, title: content.title, folderId, createdAt: now, updatedAt: now, pendingSync: true });
    imported++;
  }

  await vault.saveIndex(index);
  return { imported, skipped };
}
