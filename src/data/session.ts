// Holds the vault password in memory for as long as the app is unlocked --
// nothing else. Never persisted, never logged. Cleared on explicit lock and
// whenever the tab/app is hidden (see App.vue), so re-opening always asks
// for the password again. A closed tab or reloaded page starts fresh
// regardless, since this is plain module state, not storage.
let currentPassword: string | null = null;

export function isUnlocked(): boolean {
  return currentPassword !== null;
}

export function unlock(password: string): void {
  currentPassword = password;
}

export function currentSessionPassword(): string {
  if (currentPassword === null) throw new Error("Vault is locked");
  return currentPassword;
}

export function lock(): void {
  currentPassword = null;
}
