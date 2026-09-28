<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { useVault, ROOT_FOLDER_ID } from "./composables/useVault";
import SetupView from "./components/SetupView.vue";
import UnlockView from "./components/UnlockView.vue";
import NoteListView from "./components/NoteListView.vue";
import NoteEditorView from "./components/NoteEditorView.vue";
import SettingsView from "./components/SettingsView.vue";
import ModalDialog from "./components/ModalDialog.vue";

const vaultApi = useVault();
const syncingFromPrompt = ref(false);

async function syncFromPrompt() {
  syncingFromPrompt.value = true;
  await vaultApi.syncNow();
  syncingFromPrompt.value = false;
}

type Screen =
  | { name: "list" }
  | { name: "editor"; noteId: string; initialFolderId?: string; initialTitle?: string }
  | { name: "settings" };
const screen = ref<Screen>({ name: "list" });
const currentFolderId = ref(ROOT_FOLDER_ID);

function openNote(spec: { id: string; folderId?: string; title?: string }) {
  screen.value = { name: "editor", noteId: spec.id, initialFolderId: spec.folderId, initialTitle: spec.title };
}
function backToList() {
  screen.value = { name: "list" };
}
function openSettings() {
  screen.value = { name: "settings" };
}

// Locks the vault whenever the app leaves the foreground (tab switch, app
// backgrounded, phone locked) -- the web equivalent of asking for the
// password again on every real "app start".
function handleVisibilityChange() {
  if (document.hidden) {
    vaultApi.lock();
    screen.value = { name: "list" };
    currentFolderId.value = ROOT_FOLDER_ID;
  }
}

onMounted(async () => {
  await vaultApi.init();
  document.addEventListener("visibilitychange", handleVisibilityChange);
});
onUnmounted(() => document.removeEventListener("visibilitychange", handleVisibilityChange));
</script>

<template>
  <SetupView v-if="vaultApi.state.value === 'needs-setup'" :vault="vaultApi" />
  <UnlockView v-else-if="vaultApi.state.value === 'locked'" :vault="vaultApi" />
  <template v-else-if="vaultApi.state.value === 'unlocked'">
    <NoteListView
      v-if="screen.name === 'list'"
      :vault="vaultApi"
      v-model:current-folder-id="currentFolderId"
      @open-note="openNote"
      @open-settings="openSettings"
    />
    <NoteEditorView
      v-else-if="screen.name === 'editor'"
      :vault="vaultApi"
      :note-id="screen.noteId"
      :initial-folder-id="screen.initialFolderId"
      :initial-title="screen.initialTitle"
      @back="backToList"
    />
    <SettingsView v-else-if="screen.name === 'settings'" :vault="vaultApi" @back="backToList" />
  </template>
  <div v-else class="screen" style="align-items: center; justify-content: center">
    <span>Loading…</span>
  </div>

  <ModalDialog
    v-if="vaultApi.state.value === 'unlocked' && vaultApi.needsSyncPrompt.value"
    title="Sync with Google Drive?"
    @close="vaultApi.dismissSyncPrompt()"
  >
    <p style="font-size: 0.9rem; color: #666">
      Notes changed on another device may not be here yet -- this device's Drive connection needs a quick refresh to
      check. Google may show its sign-in/consent screen.
    </p>
    <div style="display: flex; gap: 0.5rem; margin-top: 1rem">
      <button class="btn btn-secondary" style="flex: 1" :disabled="syncingFromPrompt" @click="vaultApi.dismissSyncPrompt()">
        Not now
      </button>
      <button class="btn" style="flex: 1" :disabled="syncingFromPrompt" @click="syncFromPrompt">
        {{ syncingFromPrompt ? "Syncing…" : "Sync now" }}
      </button>
    </div>
  </ModalDialog>
</template>
