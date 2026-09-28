import { dbGet, dbPut, VAULT_STORE } from "./db";
import { createVerifier, verifyPassword, deriveKeyBytes, type Verifier } from "../crypto/passwordHash";
import { encryptGcm, decryptGcm } from "../crypto/metadataCipher";
import { randomBytes, toBase64, fromBase64, utf8Encode, utf8Decode } from "../crypto/bytes";
import * as session from "./session";
import { ROOT_FOLDER_ID, type VaultConfig, type VaultIndex } from "./types";

const CONFIG_KEY = "config";
const INDEX_KEY = "index";

export async function isSetUp(): Promise<boolean> {
  return (await dbGet<VaultConfig>(VAULT_STORE, CONFIG_KEY)) !== undefined;
}

export async function loadConfig(): Promise<VaultConfig> {
  const config = await dbGet<VaultConfig>(VAULT_STORE, CONFIG_KEY);
  if (!config) throw new Error("Vault is not set up");
  return config;
}

async function saveConfig(config: VaultConfig): Promise<void> {
  await dbPut(VAULT_STORE, CONFIG_KEY, config);
}

/** First-run setup: choose the master password. Creates the default "Daily" folder and leaves the vault unlocked. */
export async function setUp(password: string): Promise<void> {
  if (await isSetUp()) throw new Error("Vault is already set up");

  const verifier = await createVerifier(password);
  const indexKeySalt = randomBytes(16);
  const dailyFolderId = crypto.randomUUID();

  const config: VaultConfig = {
    version: 1,
    passwordSaltBase64: verifier.saltBase64,
    passwordHashBase64: verifier.hashBase64,
    passwordIterations: verifier.iterations,
    indexKeySaltBase64: toBase64(indexKeySalt),
    dailyFolderId,
  };
  await saveConfig(config);

  const initialIndex: VaultIndex = {
    folders: [{ id: dailyFolderId, name: "Daily", parentId: ROOT_FOLDER_ID }],
    notes: [],
  };
  session.unlock(password);
  await saveIndex(initialIndex);
}

/** The encrypted local index of folders + note metadata (titles, timestamps, Drive ids). */
export async function loadIndex(): Promise<VaultIndex> {
  const encrypted = await dbGet<Uint8Array>(VAULT_STORE, INDEX_KEY);
  if (!encrypted) return { folders: [], notes: [] };
  const key = await indexKeyFor(session.currentSessionPassword());
  const plaintext = await decryptGcm(encrypted, key);
  return JSON.parse(utf8Decode(plaintext)) as VaultIndex;
}

export async function saveIndex(index: VaultIndex): Promise<void> {
  const key = await indexKeyFor(session.currentSessionPassword());
  const encrypted = await encryptGcm(utf8Encode(JSON.stringify(index)), key);
  await dbPut(VAULT_STORE, INDEX_KEY, encrypted);
}

/** @returns true and unlocks the session iff `password` matches the stored verifier. */
export async function unlock(password: string): Promise<boolean> {
  const config = await loadConfig();
  const verifier: Verifier = {
    saltBase64: config.passwordSaltBase64,
    hashBase64: config.passwordHashBase64,
    iterations: config.passwordIterations,
  };
  if (!(await verifyPassword(password, verifier))) return false;
  session.unlock(password);
  return true;
}

export function lock(): void {
  session.lock();
}

export async function indexKeyFor(password: string, config?: VaultConfig): Promise<Uint8Array> {
  const cfg = config ?? (await loadConfig());
  const salt = fromBase64(cfg.indexKeySaltBase64);
  return deriveKeyBytes(password, salt, cfg.passwordIterations, 256);
}

export async function setDriveFolderId(folderId: string | undefined): Promise<void> {
  const config = await loadConfig();
  await saveConfig({ ...config, driveFolderId: folderId });
}

/**
 * Computes what the vault config *would* look like after switching to
 * `newPassword`, without saving anything yet. Callers must re-encrypt the
 * index and every note with `newPassword` and the returned index key, and
 * only call `commitRotatedConfig` once every write succeeded -- see
 * notes.ts's changePassword. This ordering means a failure partway through
 * never leaves the vault unable to decrypt its own files.
 */
export async function buildRotatedConfig(newPassword: string): Promise<{ config: VaultConfig; indexKey: Uint8Array }> {
  const current = await loadConfig();
  const verifier = await createVerifier(newPassword, current.passwordIterations);
  const indexKeySalt = randomBytes(16);
  const config: VaultConfig = {
    ...current,
    passwordSaltBase64: verifier.saltBase64,
    passwordHashBase64: verifier.hashBase64,
    passwordIterations: verifier.iterations,
    indexKeySaltBase64: toBase64(indexKeySalt),
  };
  const indexKey = await indexKeyFor(newPassword, config);
  return { config, indexKey };
}

export async function commitRotatedConfig(config: VaultConfig, newPassword: string): Promise<void> {
  await saveConfig(config);
  session.unlock(newPassword);
}

/** Encrypts and stores `index` under an explicitly-given key, for use mid password-rotation before the new password is the active session password. */
export async function saveIndexWithKey(index: VaultIndex, indexKey: Uint8Array): Promise<void> {
  const encrypted = await encryptGcm(utf8Encode(JSON.stringify(index)), indexKey);
  await dbPut(VAULT_STORE, INDEX_KEY, encrypted);
}
