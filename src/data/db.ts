// Minimal promise-based IndexedDB wrapper -- just the handful of
// operations this app needs (get/put/delete by key, list all keys/values
// in a store). No external dependency; IndexedDB's callback API is thin
// enough to wrap directly.

const DB_NAME = "secure-notes";
const DB_VERSION = 1;
export const VAULT_STORE = "vault";
export const NOTES_STORE = "notes";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(VAULT_STORE)) db.createObjectStore(VAULT_STORE);
      if (!db.objectStoreNames.contains(NOTES_STORE)) db.createObjectStore(NOTES_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function dbGet<T>(store: string, key: string): Promise<T | undefined> {
  const db = await openDb();
  const tx = db.transaction(store, "readonly");
  return promisify(tx.objectStore(store).get(key));
}

export async function dbPut(store: string, key: string, value: unknown): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(store, "readwrite");
  await promisify(tx.objectStore(store).put(value, key));
}

export async function dbDelete(store: string, key: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(store, "readwrite");
  await promisify(tx.objectStore(store).delete(key));
}

export async function dbGetAllKeys(store: string): Promise<string[]> {
  const db = await openDb();
  const tx = db.transaction(store, "readonly");
  const keys = await promisify(tx.objectStore(store).getAllKeys());
  return keys as string[];
}

/** Deletes the whole local database -- used by "reset local data" in Settings. */
export async function deleteDatabase(): Promise<void> {
  dbPromise = null;
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
}

/** Test-only: forget the cached connection so the next call reopens against whatever `indexedDB` currently points to. */
export function resetConnectionForTests(): void {
  dbPromise = null;
}
