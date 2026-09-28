import { ref, computed } from "vue";
import * as vault from "../data/vault";
import * as notesRepo from "../data/notes";
import { getAccessToken, isDriveConfigured as driveAuthConfigured } from "../data/driveAuth";
import { exportVaultZip, importVaultZip } from "../data/zipBackup";
import { currentSessionPassword } from "../data/session";
import { WrongPasswordError } from "../crypto/agileDocx";
import type { Folder, Note, NoteMeta } from "../data/types";
import { ROOT_FOLDER_ID } from "../data/types";

export type AppState = "loading" | "needs-setup" | "locked" | "unlocked";

const state = ref<AppState>("loading");
const notes = ref<NoteMeta[]>([]);
const folders = ref<Folder[]>([]);
const driveConnected = ref(false);
const needsSyncPrompt = ref(false);

async function refreshLists() {
  notes.value = await notesRepo.listNotes();
  folders.value = await notesRepo.listFolders();
}

async function refreshState() {
  state.value = (await vault.isSetUp()) ? "locked" : "needs-setup";
}

async function refreshDriveConnected() {
  const config = await vault.loadConfig().catch(() => null);
  driveConnected.value = Boolean(config?.driveFolderId);
}

async function trySilentSync() {
  if (!driveConnected.value || !driveAuthConfigured()) return;
  const token = await getAccessToken(false).catch(() => null);
  if (token) await notesRepo.syncPending(token);
}

/**
 * Runs on every unlock (i.e. every time the app is opened/re-entered) so
 * Drive stays current in both directions without a manual "Sync now" tap --
 * but only using an already-cached token (getAccessToken(false) never makes
 * a live request, see driveAuth.ts). If nothing's cached, surfaces
 * `needsSyncPrompt` instead of syncing, since getting a fresh token requires
 * a real user gesture.
 */
async function trySilentFullSync() {
  if (!driveConnected.value || !driveAuthConfigured()) return;
  const token = await getAccessToken(false).catch(() => null);
  if (!token) {
    needsSyncPrompt.value = true;
    return;
  }
  needsSyncPrompt.value = false;
  await notesRepo.syncPending(token);
  await notesRepo.restoreFromDrive(token);
  await refreshLists();
}

export function useVault() {
  return {
    state: computed(() => state.value),
    notes: computed(() => notes.value),
    folders: computed(() => folders.value),
    driveConnected: computed(() => driveConnected.value),
    needsSyncPrompt: computed(() => needsSyncPrompt.value),
    isDriveConfigured: driveAuthConfigured(),

    async init() {
      await refreshState();
    },

    async setUpVault(password: string) {
      await vault.setUp(password);
      await refreshLists();
      await refreshDriveConnected();
      state.value = "unlocked";
    },

    async unlock(password: string): Promise<boolean> {
      const ok = await vault.unlock(password);
      if (ok) {
        await refreshLists();
        await refreshDriveConnected();
        state.value = "unlocked";
        void trySilentFullSync();
      }
      return ok;
    },

    lock() {
      vault.lock();
      notes.value = [];
      needsSyncPrompt.value = false;
      if (state.value === "unlocked") state.value = "locked";
    },

    dismissSyncPrompt() {
      needsSyncPrompt.value = false;
    },

    async reloadNotes() {
      await refreshLists();
    },

    todayNoteId: notesRepo.todayNoteId,
    suggestedTitleForDailyId: notesRepo.suggestedTitleForDailyId,
    dailyFolderId: notesRepo.dailyFolderId,
    isDailyId: (id: string) => notesRepo.DAILY_ID_PATTERN.test(id),

    async loadNote(id: string): Promise<Note | null> {
      return notesRepo.findNote(id);
    },

    async saveNote(id: string, folderId: string, title: string, body: string): Promise<Note> {
      const note = await notesRepo.saveNote(id, folderId, title, body);
      await refreshLists();
      void trySilentSync();
      return note;
    },

    async deleteNote(id: string) {
      const driveFileId = await notesRepo.deleteNote(id);
      await refreshLists();
      if (driveFileId) {
        const token = await getAccessToken(true).catch(() => null);
        if (token) await notesRepo.deleteRemoteFile(token, driveFileId);
      }
    },

    async createFolder(name: string, parentId: string): Promise<Folder> {
      const folder = await notesRepo.createFolder(name, parentId);
      await refreshLists();
      return folder;
    },

    async renameFolder(id: string, newName: string) {
      await notesRepo.renameFolder(id, newName);
      await refreshLists();
      void trySilentSync();
    },

    async moveFolder(id: string, newParentId: string) {
      await notesRepo.moveFolder(id, newParentId);
      await refreshLists();
      void trySilentSync();
    },

    /** false means the folder still has notes or subfolders in it. */
    async deleteFolder(id: string): Promise<boolean> {
      const ok = await notesRepo.deleteFolder(id);
      if (ok) await refreshLists();
      return ok;
    },

    async connectDrive(): Promise<boolean> {
      const token = await getAccessToken(true);
      if (!token) return false;
      const ok = await notesRepo.connectDrive(token);
      await refreshLists();
      await refreshDriveConnected();
      return ok;
    },

    /** @returns null if a token couldn't be obtained (offline, or Drive access needs reconnecting), else how many notes were restored. */
    async syncNow(): Promise<number | null> {
      const token = await getAccessToken(true).catch(() => null);
      if (!token) return null;
      needsSyncPrompt.value = false;
      await notesRepo.syncPending(token);
      const restored = await notesRepo.restoreFromDrive(token);
      await refreshLists();
      return restored;
    },

    async changePassword(oldPassword: string, newPassword: string): Promise<boolean> {
      const ok = await notesRepo.changePassword(oldPassword, newPassword);
      if (ok) void trySilentSync();
      return ok;
    },

    async exportZip(): Promise<Blob> {
      return exportVaultZip();
    },

    /** Decrypts with the currently unlocked vault's password -- for restoring a backup made with the same password. */
    async importZip(bytes: Uint8Array) {
      const result = await importVaultZip(bytes, currentSessionPassword());
      await refreshLists();
      return result;
    },
  };
}

export function isWrongPassword(e: unknown): boolean {
  return e instanceof WrongPasswordError;
}

export { ROOT_FOLDER_ID };
