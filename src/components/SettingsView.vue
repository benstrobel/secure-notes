<script setup lang="ts">
import { ref } from "vue";
import type { useVault } from "../composables/useVault";
import ModalDialog from "./ModalDialog.vue";

const props = defineProps<{ vault: ReturnType<typeof useVault> }>();
const emit = defineEmits<{ back: [] }>();

const connecting = ref(false);
const syncing = ref(false);
const syncMessage = ref<string | null>(null);

async function connectDrive() {
  connecting.value = true;
  const ok = await props.vault.connectDrive();
  connecting.value = false;
  syncMessage.value = ok ? "Connected to Google Drive." : "Couldn't connect to Drive -- try again.";
}

async function syncNow() {
  syncing.value = true;
  const restored = await props.vault.syncNow();
  syncing.value = false;
  syncMessage.value = restored === null ? "Couldn't reach Drive -- will retry automatically later." : restored > 0 ? `Restored ${restored} note(s) from Drive.` : "Sync complete.";
}

async function exportZip() {
  const blob = await props.vault.exportZip();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `secure-notes-backup-${new Date().toISOString().slice(0, 10)}.zip`;
  a.click();
  URL.revokeObjectURL(url);
}

const importing = ref(false);
const importMessage = ref<string | null>(null);
async function onImportFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  importing.value = true;
  importMessage.value = null;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await props.vault.importZip(bytes);
    importMessage.value = `Imported ${result.imported} note(s)${result.skipped ? `, skipped ${result.skipped} (wrong password or not a Secure Notes file)` : ""}.`;
  } catch (e) {
    importMessage.value = "Couldn't read that file as a zip.";
  } finally {
    importing.value = false;
    input.value = "";
  }
}

const showChangePassword = ref(false);
const oldPassword = ref("");
const newPassword = ref("");
const confirmPassword = ref("");
const changeError = ref<string | null>(null);
const changing = ref(false);
async function submitChangePassword() {
  if (newPassword.value.length < 8) {
    changeError.value = "Use at least 8 characters.";
    return;
  }
  if (newPassword.value !== confirmPassword.value) {
    changeError.value = "New passwords don't match.";
    return;
  }
  changing.value = true;
  const ok = await props.vault.changePassword(oldPassword.value, newPassword.value);
  changing.value = false;
  if (ok) {
    showChangePassword.value = false;
    oldPassword.value = newPassword.value = confirmPassword.value = "";
  } else {
    changeError.value = "Current password is incorrect.";
  }
}

function lockNow() {
  props.vault.lock();
  emit("back");
}
</script>

<template>
  <div class="screen">
    <div class="top-bar">
      <div class="top-bar-inner">
        <button class="icon-btn" @click="emit('back')" aria-label="Back">←</button>
        <h1>Settings</h1>
      </div>
    </div>

    <div class="screen-body">
      <section style="margin-bottom: 1.5rem">
        <h2 style="font-size: 1rem">Google Drive backup</h2>
        <p style="color: #666; font-size: 0.9rem">
          <template v-if="!vault.isDriveConfigured">
            Drive sync isn't configured for this deployment (missing OAuth client id). See README.md.
          </template>
          <template v-else-if="vault.driveConnected.value">
            Connected -- notes upload to a "Secure Notes" folder in your Drive automatically, mirroring your local folders.
          </template>
          <template v-else>
            Not connected. The first time, Google will show an "unverified app" warning -- expected for a personal
            deployment; choose Advanced → Go to (your app) to continue.
          </template>
        </p>
        <button v-if="vault.isDriveConfigured" class="btn btn-block" :disabled="connecting" @click="connectDrive">
          {{ connecting ? "Connecting…" : vault.driveConnected.value ? "Reconnect Google Drive" : "Connect Google Drive" }}
        </button>
        <button v-if="vault.driveConnected.value" class="btn btn-secondary btn-block" style="margin-top: 0.5rem" :disabled="syncing" @click="syncNow">
          {{ syncing ? "Syncing…" : "Sync now" }}
        </button>
        <p v-if="syncMessage" style="font-size: 0.85rem; color: #666">{{ syncMessage }}</p>
      </section>

      <section style="margin-bottom: 1.5rem">
        <h2 style="font-size: 1rem">Backup file</h2>
        <p style="color: #666; font-size: 0.9rem">
          Every note is still readable from just these files with the right password -- even without Drive or this app.
          Download a zip of everything, or restore from one (your own export, or a zip you made yourself of the Drive
          folder).
        </p>
        <button class="btn btn-block" @click="exportZip">Download vault as zip</button>
        <label class="btn btn-secondary btn-block" style="margin-top: 0.5rem; display: flex">
          {{ importing ? "Importing…" : "Restore from zip" }}
          <input type="file" accept=".zip" style="display: none" :disabled="importing" @change="onImportFile" />
        </label>
        <p v-if="importMessage" style="font-size: 0.85rem; color: #666">{{ importMessage }}</p>
      </section>

      <section style="margin-bottom: 1.5rem">
        <h2 style="font-size: 1rem">Master password</h2>
        <p style="color: #666; font-size: 0.9rem">Also unlocks each note's .docx file on a PC.</p>
        <button class="btn btn-block" @click="showChangePassword = true">Change password</button>
      </section>

      <button class="btn btn-secondary btn-block" @click="lockNow">Lock now</button>
    </div>

    <ModalDialog v-if="showChangePassword" title="Change password" @close="showChangePassword = false">
      <p style="font-size: 0.85rem; color: #666">This re-encrypts every note and its Drive backup with the new password.</p>
      <input v-model="oldPassword" type="password" class="field" placeholder="Current password" autocomplete="current-password" style="margin-bottom: 0.5rem" />
      <input v-model="newPassword" type="password" class="field" placeholder="New password" autocomplete="new-password" style="margin-bottom: 0.5rem" />
      <input v-model="confirmPassword" type="password" class="field" placeholder="Confirm new password" autocomplete="new-password" />
      <p v-if="changeError" class="error-text">{{ changeError }}</p>
      <div style="display: flex; gap: 0.5rem; margin-top: 1rem">
        <button class="btn btn-secondary" style="flex: 1" :disabled="changing" @click="showChangePassword = false">Cancel</button>
        <button class="btn" style="flex: 1" :disabled="changing" @click="submitChangePassword">{{ changing ? "Working…" : "Change" }}</button>
      </div>
    </ModalDialog>
  </div>
</template>
