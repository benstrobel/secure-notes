import { dbGet, dbPut, dbDelete, NOTES_STORE } from "./db";
import * as vault from "./vault";
import * as session from "./session";
import * as driveClient from "./driveClient";
import { encryptDocxFile, decryptDocxFile } from "../crypto/docxFile";
import { verifyPassword } from "../crypto/passwordHash";
import { ROOT_FOLDER_ID, type Folder, type Note, type NoteMeta, type VaultIndex } from "./types";

// -------- daily note helpers --------

export function todayNoteId(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export const DAILY_ID_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function suggestedTitleForDailyId(id: string): string {
  const m = id.match(DAILY_ID_PATTERN);
  if (!m) return "";
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return date.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
}

export async function dailyFolderId(): Promise<string> {
  return (await vault.loadConfig()).dailyFolderId;
}

// -------- notes / folders read --------

export async function listNotes(): Promise<NoteMeta[]> {
  const index = await vault.loadIndex();
  return [...index.notes].sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function listFolders(): Promise<Folder[]> {
  return (await vault.loadIndex()).folders;
}

/** @returns null if `id` has no file yet -- e.g. today's entry hasn't been written to. */
export async function findNote(id: string): Promise<Note | null> {
  const index = await vault.loadIndex();
  const meta = index.notes.find((n) => n.id === id);
  if (!meta) return null;
  const encrypted = await dbGet<Uint8Array>(NOTES_STORE, id);
  if (!encrypted) return null;
  const content = await decryptDocxFile(session.currentSessionPassword(), encrypted);
  return { id, title: meta.title, body: content.body, folderId: meta.folderId, createdAt: meta.createdAt, updatedAt: meta.updatedAt };
}

// -------- notes write --------

/**
 * Creates `id`'s file if it doesn't exist yet, or overwrites it if it
 * does -- this is the only place a note's `.docx` gets written, so it's
 * what makes file creation lazy: nothing is written to disk (or synced to
 * Drive) until a save actually happens, e.g. when the user types
 * something into today's entry and leaves the editor.
 */
export async function saveNote(id: string, folderId: string, title: string, body: string): Promise<Note> {
  const now = Date.now();
  const index = await vault.loadIndex();
  const existing = index.notes.find((n) => n.id === id);
  const createdAt = existing?.createdAt ?? now;

  const encrypted = await encryptDocxFile(session.currentSessionPassword(), title, body);
  await dbPut(NOTES_STORE, id, encrypted);

  const newMeta: NoteMeta = { ...(existing ?? { id, title, folderId, createdAt, updatedAt: now, pendingSync: false }), title, folderId, updatedAt: now, pendingSync: true };
  const notes = existing ? index.notes.map((n) => (n.id === id ? newMeta : n)) : [...index.notes, newMeta];
  await vault.saveIndex({ ...index, notes });

  return { id, title, body, folderId, createdAt, updatedAt: now };
}

/** @returns the note's Drive file id, if it had one, so the caller can best-effort delete it remotely too. */
export async function deleteNote(id: string): Promise<string | undefined> {
  const index = await vault.loadIndex();
  const driveFileId = index.notes.find((n) => n.id === id)?.driveFileId;
  await dbDelete(NOTES_STORE, id);
  await vault.saveIndex({ ...index, notes: index.notes.filter((n) => n.id !== id) });
  return driveFileId;
}

// -------- folders --------

export async function createFolder(name: string, parentId: string): Promise<Folder> {
  const index = await vault.loadIndex();
  const folder: Folder = { id: crypto.randomUUID(), name, parentId };
  await vault.saveIndex({ ...index, folders: [...index.folders, folder] });
  return folder;
}

export async function renameFolder(id: string, newName: string): Promise<void> {
  const index = await vault.loadIndex();
  const folders = index.folders.map((f) => (f.id === id ? { ...f, name: newName } : f));
  await vault.saveIndex({ ...index, folders });
  await markNotesInFolderPending(id);
}

export async function moveFolder(id: string, newParentId: string): Promise<void> {
  const index = await vault.loadIndex();
  const folders = index.folders.map((f) => (f.id === id ? { ...f, parentId: newParentId } : f));
  await vault.saveIndex({ ...index, folders });
  await markNotesInFolderPending(id);
}

async function markNotesInFolderPending(folderId: string): Promise<void> {
  const index = await vault.loadIndex();
  const notes = index.notes.map((n) => (n.folderId === folderId ? { ...n, pendingSync: true } : n));
  await vault.saveIndex({ ...index, notes });
}

/** @returns false without deleting anything if the folder still has notes or subfolders in it. */
export async function deleteFolder(id: string): Promise<boolean> {
  const index = await vault.loadIndex();
  const hasNotes = index.notes.some((n) => n.folderId === id);
  const hasSubfolders = index.folders.some((f) => f.parentId === id);
  if (hasNotes || hasSubfolders) return false;
  await vault.saveIndex({ ...index, folders: index.folders.filter((f) => f.id !== id) });
  return true;
}

// -------- Drive sync --------

export function fileNameFor(meta: NoteMeta): string {
  if (DAILY_ID_PATTERN.test(meta.id)) return `${meta.id}.docx`;
  const sanitized = meta.title.replace(/[/\\:*?"<>|]/g, "_").trim() || meta.id;
  return `${sanitized}.docx`;
}

/** Walks the local folder chain up to root, creating/finding matching Drive folders, caching each folder's driveFolderId as it goes. */
async function ensureDriveFolderPath(accessToken: string, folderId: string, index: VaultIndex, vaultDriveRootId: string): Promise<string> {
  if (folderId === ROOT_FOLDER_ID) return vaultDriveRootId;
  const folder = index.folders.find((f) => f.id === folderId);
  if (!folder) return vaultDriveRootId;
  if (folder.driveFolderId) return folder.driveFolderId;
  const parentDriveId = await ensureDriveFolderPath(accessToken, folder.parentId, index, vaultDriveRootId);
  const driveId = await driveClient.ensureFolder(accessToken, folder.name, parentDriveId);
  if (driveId) folder.driveFolderId = driveId;
  return driveId ?? parentDriveId;
}

/**
 * First connection to Drive (or reconnecting on a new device/browser):
 * finds or creates the vault's root Drive folder, pulls in anything
 * already there, then pushes anything local that isn't up there yet.
 */
export async function connectDrive(accessToken: string): Promise<boolean> {
  const driveRootId = await driveClient.ensureFolder(accessToken, "Secure Notes");
  if (!driveRootId) return false;
  await vault.setDriveFolderId(driveRootId);
  await restoreFromDrive(accessToken);
  await syncPending(accessToken);
  return true;
}

/** Uploads/updates every note still flagged pendingSync. Best-effort: failures just stay pending for next time. */
export async function syncPending(accessToken: string): Promise<void> {
  const config = await vault.loadConfig();
  if (!config.driveFolderId) return;
  const index = await vault.loadIndex();
  let changed = false;

  for (const meta of index.notes) {
    if (!meta.pendingSync) continue;
    const encrypted = await dbGet<Uint8Array>(NOTES_STORE, meta.id);
    if (!encrypted) continue;

    const targetDriveFolderId = await ensureDriveFolderPath(accessToken, meta.folderId, index, config.driveFolderId);
    const fileName = fileNameFor(meta);

    if (!meta.driveFileId) {
      const newId = await driveClient.uploadNewFile(accessToken, targetDriveFolderId, fileName, encrypted);
      if (!newId) continue;
      meta.driveFileId = newId;
      meta.driveParentFolderId = targetDriveFolderId;
      meta.pendingSync = false;
      changed = true;
      continue;
    }

    const ok = await driveClient.updateFileContent(accessToken, meta.driveFileId, encrypted);
    if (!ok) continue;
    if (meta.driveParentFolderId !== targetDriveFolderId) {
      await driveClient.renameOrMoveFile(accessToken, meta.driveFileId, {
        newName: fileName,
        newParentId: targetDriveFolderId,
        oldParentId: meta.driveParentFolderId,
      });
      meta.driveParentFolderId = targetDriveFolderId;
    } else {
      await driveClient.renameOrMoveFile(accessToken, meta.driveFileId, { newName: fileName });
    }
    meta.pendingSync = false;
    changed = true;
  }

  if (changed) await vault.saveIndex(index);
}

export async function deleteRemoteFile(accessToken: string, driveFileId: string): Promise<boolean> {
  return driveClient.deleteFile(accessToken, driveFileId);
}

/**
 * Recursively walks the Drive folder tree under the vault's root,
 * mirroring any folders not yet known locally and importing any `.docx`
 * files not already tracked by a local note. Requires the currently
 * unlocked password to also unlock those remote files.
 * @returns how many notes were pulled in.
 */
export async function restoreFromDrive(accessToken: string): Promise<number> {
  const config = await vault.loadConfig();
  if (!config.driveFolderId) return 0;
  const index = await vault.loadIndex();
  let imported = 0;

  async function walk(driveFolderId: string, localFolderId: string): Promise<void> {
    const children = await driveClient.listFolderChildren(accessToken, driveFolderId);
    for (const child of children) {
      if (child.mimeType === "application/vnd.google-apps.folder") {
        let localSub = index.folders.find((f) => f.driveFolderId === child.id);
        if (!localSub) {
          localSub = index.folders.find((f) => f.parentId === localFolderId && f.name === child.name && !f.driveFolderId);
        }
        if (localSub) {
          localSub.driveFolderId = child.id;
        } else {
          localSub = { id: crypto.randomUUID(), name: child.name, parentId: localFolderId, driveFolderId: child.id };
          index.folders.push(localSub);
        }
        await walk(child.id, localSub.id);
      } else if (child.name.endsWith(".docx") && !index.notes.some((n) => n.driveFileId === child.id)) {
        const bytes = await driveClient.downloadFile(accessToken, child.id);
        if (!bytes) continue;
        try {
          const content = await decryptDocxFile(session.currentSessionPassword(), bytes);
          const now = Date.now();
          const id = child.name.match(DAILY_ID_PATTERN) ? child.name.replace(/\.docx$/, "") : crypto.randomUUID();
          if (index.notes.some((n) => n.id === id)) continue; // already have this daily note locally
          await dbPut(NOTES_STORE, id, bytes);
          index.notes.push({
            id,
            title: content.title,
            folderId: localFolderId,
            createdAt: now,
            updatedAt: now,
            pendingSync: false,
            driveFileId: child.id,
            driveParentFolderId: driveFolderId,
          });
          imported++;
        } catch {
          continue; // wrong password / unrelated file -- skip it
        }
      }
    }
  }

  await walk(config.driveFolderId, ROOT_FOLDER_ID);
  await vault.saveIndex(index);
  return imported;
}

/**
 * Re-encrypts the index and every note under `newPassword`. Nothing is
 * overwritten until every note has been successfully re-encrypted, so a
 * failure partway through leaves the vault exactly as it was (still
 * readable with the old password) instead of stranded.
 */
export async function changePassword(oldPassword: string, newPassword: string): Promise<boolean> {
  const config = await vault.loadConfig();
  const ok = await verifyPassword(oldPassword, {
    saltBase64: config.passwordSaltBase64,
    hashBase64: config.passwordHashBase64,
    iterations: config.passwordIterations,
  });
  if (!ok) return false;

  const index = await vault.loadIndex();
  const reEncrypted = new Map<string, Uint8Array>();
  try {
    for (const meta of index.notes) {
      const encrypted = await dbGet<Uint8Array>(NOTES_STORE, meta.id);
      if (!encrypted) continue;
      const content = await decryptDocxFile(oldPassword, encrypted);
      reEncrypted.set(meta.id, await encryptDocxFile(newPassword, content.title, content.body));
    }
  } catch {
    return false;
  }

  // Everything re-encrypted successfully -- commit: write the new note
  // files and the new index (keyed to the new password), then finally the
  // new vault config. A failure before this point leaves the old password
  // and old files untouched.
  const { config: newConfig, indexKey } = await vault.buildRotatedConfig(newPassword);
  for (const [id, bytes] of reEncrypted) await dbPut(NOTES_STORE, id, bytes);

  const pendingIndex: VaultIndex = { ...index, notes: index.notes.map((n) => ({ ...n, pendingSync: true })) };
  await vault.saveIndexWithKey(pendingIndex, indexKey);
  await vault.commitRotatedConfig(newConfig, newPassword);
  return true;
}
