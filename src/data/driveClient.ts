// Minimal Google Drive v3 REST client using plain fetch() -- no
// google-api-client, just the handful of calls this app needs. Every call
// takes a short-lived OAuth access token obtained via Google Identity
// Services (see driveAuth.ts); this module knows nothing about how that
// token was obtained.
import { concatBytes, utf8Encode } from "../crypto/bytes";

const FILES_URL = "https://www.googleapis.com/drive/v3/files";
const UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";
const FOLDER_MIME = "application/vnd.google-apps.folder";
export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export interface DriveEntry {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
}

export interface UploadedFile {
  id: string;
  modifiedTime: string;
}

function authHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

async function jsonOrNull(response: Response): Promise<any | null> {
  if (!response.ok) return null;
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** Finds a folder named `name` directly under `parentId` (or Drive root if omitted), or creates it. */
export async function ensureFolder(accessToken: string, name: string, parentId?: string): Promise<string | null> {
  const parentClause = parentId ? `'${parentId}' in parents` : `'root' in parents`;
  const query = `mimeType='${FOLDER_MIME}' and name='${name.replace(/'/g, "\\'")}' and trashed=false and ${parentClause}`;
  const url = `${FILES_URL}?q=${encodeURIComponent(query)}&fields=${encodeURIComponent("files(id,name)")}&spaces=drive`;
  const found = await jsonOrNull(await fetch(url, { headers: authHeaders(accessToken) }));
  if (found?.files?.length) return found.files[0].id;

  const body = { name, mimeType: FOLDER_MIME, parents: parentId ? [parentId] : undefined };
  const created = await jsonOrNull(
    await fetch(FILES_URL, {
      method: "POST",
      headers: { ...authHeaders(accessToken), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return created?.id ?? null;
}

export async function uploadNewFile(accessToken: string, parentId: string, fileName: string, content: Uint8Array): Promise<UploadedFile | null> {
  const metadata = JSON.stringify({ name: fileName, parents: [parentId] });
  const boundary = `securenotes-${crypto.randomUUID()}`;
  const parts: Uint8Array[] = [
    utf8Encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`),
    utf8Encode(`--${boundary}\r\nContent-Type: ${DOCX_MIME}\r\n\r\n`),
    content,
    utf8Encode(`\r\n--${boundary}--`),
  ];
  const body = concatBytes(...parts);

  const response = await fetch(`${UPLOAD_URL}?uploadType=multipart&fields=${encodeURIComponent("id,modifiedTime")}`, {
    method: "POST",
    headers: { ...authHeaders(accessToken), "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  const result = await jsonOrNull(response);
  return result?.id && result?.modifiedTime ? { id: result.id, modifiedTime: result.modifiedTime } : null;
}

/** @returns the file's new modifiedTime on success, else null. */
export async function updateFileContent(accessToken: string, fileId: string, content: Uint8Array): Promise<string | null> {
  const response = await fetch(`${UPLOAD_URL}/${fileId}?uploadType=media&fields=${encodeURIComponent("modifiedTime")}`, {
    method: "PATCH",
    headers: { ...authHeaders(accessToken), "Content-Type": DOCX_MIME },
    body: content,
  });
  const result = await jsonOrNull(response);
  return result?.modifiedTime ?? null;
}

/** Renames and/or moves a file to a different parent folder. @returns the file's new modifiedTime on success, else null. */
export async function renameOrMoveFile(
  accessToken: string,
  fileId: string,
  opts: { newName?: string; newParentId?: string; oldParentId?: string },
): Promise<string | null> {
  const params = new URLSearchParams();
  if (opts.newParentId) params.set("addParents", opts.newParentId);
  if (opts.oldParentId) params.set("removeParents", opts.oldParentId);
  params.set("fields", "modifiedTime");
  const url = `${FILES_URL}/${fileId}?${params}`;
  const response = await fetch(url, {
    method: "PATCH",
    headers: { ...authHeaders(accessToken), "Content-Type": "application/json" },
    body: JSON.stringify(opts.newName ? { name: opts.newName } : {}),
  });
  const result = await jsonOrNull(response);
  return result?.modifiedTime ?? null;
}

export async function deleteFile(accessToken: string, fileId: string): Promise<boolean> {
  const response = await fetch(`${FILES_URL}/${fileId}`, { method: "DELETE", headers: authHeaders(accessToken) });
  return response.ok || response.status === 404;
}

export async function listFolderChildren(accessToken: string, folderId: string): Promise<DriveEntry[]> {
  const query = `'${folderId}' in parents and trashed=false`;
  const url = `${FILES_URL}?q=${encodeURIComponent(query)}&fields=${encodeURIComponent("files(id,name,mimeType,modifiedTime)")}&pageSize=1000`;
  const result = await jsonOrNull(await fetch(url, { headers: authHeaders(accessToken) }));
  return result?.files ?? [];
}

export async function downloadFile(accessToken: string, fileId: string): Promise<Uint8Array | null> {
  const response = await fetch(`${FILES_URL}/${fileId}?alt=media`, { headers: authHeaders(accessToken) });
  if (!response.ok) return null;
  return new Uint8Array(await response.arrayBuffer());
}
