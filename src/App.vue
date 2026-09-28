<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { useVault, ROOT_FOLDER_ID } from "./composables/useVault";
import LandingView from "./components/LandingView.vue";
import SetupView from "./components/SetupView.vue";
import UnlockView from "./components/UnlockView.vue";
import NoteListView from "./components/NoteListView.vue";
import NoteEditorView from "./components/NoteEditorView.vue";
import SearchView from "./components/SearchView.vue";
import SettingsView from "./components/SettingsView.vue";
import ConflictCompareView from "./components/ConflictCompareView.vue";
import ModalDialog from "./components/ModalDialog.vue";

const vaultApi = useVault();
const syncingFromPrompt = ref(false);

// Shown once, only to brand-new visitors (no vault created yet). Returning
// users land straight on the unlock screen -- no marketing copy in the way
// of opening their notes. Dismissing it is remembered so a reload mid-setup
// doesn't bring it back.
const LANDING_DISMISSED_KEY = "secure-notes-landing-dismissed";
const showLanding = ref(false);
function dismissLanding() {
  showLanding.value = false;
  localStorage.setItem(LANDING_DISMISSED_KEY, "1");
}

async function syncFromPrompt() {
  syncingFromPrompt.value = true;
  await vaultApi.syncNow();
  syncingFromPrompt.value = false;
}

type Screen =
  | { name: "list" }
  | { name: "editor"; noteId: string; initialFolderId?: string; initialTitle?: string; initialSearchQuery?: string }
  | { name: "settings" }
  | { name: "search" }
  | { name: "compare"; noteAId: string; noteBId: string };
const screen = ref<Screen>({ name: "list" });
const currentFolderId = ref(ROOT_FOLDER_ID);

function openNote(spec: { id: string; folderId?: string; title?: string; searchQuery?: string }) {
  screen.value = { name: "editor", noteId: spec.id, initialFolderId: spec.folderId, initialTitle: spec.title, initialSearchQuery: spec.searchQuery };
}
function backToList() {
  screen.value = { name: "list" };
}
function openSettings() {
  screen.value = { name: "settings" };
}
function openSearch() {
  screen.value = { name: "search" };
}
function openCompare(spec: { aId: string; bId: string }) {
  screen.value = { name: "compare", noteAId: spec.aId, noteBId: spec.bId };
}

// Locks the vault whenever the app leaves the foreground (tab switch, app
// backgrounded, phone locked) -- the web equivalent of asking for the
// password again on every real "app start".
function handleVisibilityChange() {
  if (document.hidden) {
    // Don't lock out from under an in-progress Drive sign-in -- opening
    // Google's consent screen backgrounds this tab too, and locking here
    // wipes the in-memory session password before the OAuth round-trip
    // (and the sync/connect it's for) can finish.
    if (vaultApi.isDriveAuthInFlight()) return;
    vaultApi.lock();
    screen.value = { name: "list" };
    currentFolderId.value = ROOT_FOLDER_ID;
  }
}

onMounted(async () => {
  await vaultApi.init();
  if (vaultApi.state.value === "needs-setup" && localStorage.getItem(LANDING_DISMISSED_KEY) !== "1") {
    showLanding.value = true;
  }
  document.addEventListener("visibilitychange", handleVisibilityChange);
});
onUnmounted(() => document.removeEventListener("visibilitychange", handleVisibilityChange));
</script>

<template>
  <LandingView v-if="showLanding" @get-started="dismissLanding" />
  <SetupView v-else-if="vaultApi.state.value === 'needs-setup'" :vault="vaultApi" />
  <UnlockView v-else-if="vaultApi.state.value === 'locked'" :vault="vaultApi" />
  <template v-else-if="vaultApi.state.value === 'unlocked'">
    <NoteListView
      v-if="screen.name === 'list'"
      :vault="vaultApi"
      v-model:current-folder-id="currentFolderId"
      @open-note="openNote"
      @open-settings="openSettings"
      @open-search="openSearch"
      @compare-conflict="openCompare"
    />
    <NoteEditorView
      v-else-if="screen.name === 'editor'"
      :vault="vaultApi"
      :note-id="screen.noteId"
      :initial-folder-id="screen.initialFolderId"
      :initial-title="screen.initialTitle"
      :initial-search-query="screen.initialSearchQuery"
      @back="backToList"
    />
    <SettingsView v-else-if="screen.name === 'settings'" :vault="vaultApi" @back="backToList" />
    <SearchView v-else-if="screen.name === 'search'" :vault="vaultApi" @back="backToList" @open-note="openNote" />
    <ConflictCompareView
      v-else-if="screen.name === 'compare'"
      :vault="vaultApi"
      :note-a-id="screen.noteAId"
      :note-b-id="screen.noteBId"
      @back="backToList"
    />
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
