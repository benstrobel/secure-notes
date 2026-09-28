export interface VaultConfig {
  version: number;
  passwordSaltBase64: string;
  passwordHashBase64: string;
  passwordIterations: number;
  indexKeySaltBase64: string;
  /** The id of the folder created at setup time that "Add daily note" always files into. */
  dailyFolderId: string;
  /** This vault's root Drive folder, once connected. */
  driveFolderId?: string;
}

export const ROOT_FOLDER_ID = "root";

export interface Folder {
  id: string;
  name: string;
  /** ROOT_FOLDER_ID for a top-level folder. */
  parentId: string;
  /** This folder's own Drive folder id, once it's been mirrored there. */
  driveFolderId?: string;
}

export interface NoteMeta {
  id: string;
  title: string;
  folderId: string;
  createdAt: number;
  updatedAt: number;
  pendingSync: boolean;
  driveFileId?: string;
  /** Which Drive folder driveFileId currently lives in -- lets syncPending detect a move and issue addParents/removeParents. */
  driveParentFolderId?: string;
}

export interface VaultIndex {
  folders: Folder[];
  notes: NoteMeta[];
}

export interface Note {
  id: string;
  title: string;
  body: string;
  folderId: string;
  createdAt: number;
  updatedAt: number;
}
