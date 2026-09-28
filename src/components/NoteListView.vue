<script setup lang="ts">
import { computed, ref } from "vue";
import type { useVault } from "../composables/useVault";
import { ROOT_FOLDER_ID } from "../composables/useVault";
import ModalDialog from "./ModalDialog.vue";

const props = defineProps<{ vault: ReturnType<typeof useVault>; currentFolderId: string }>();
const emit = defineEmits<{
  "open-note": [spec: { id: string; folderId?: string; title?: string }];
  "open-settings": [];
  "open-search": [];
  "update:currentFolderId": [id: string];
  "compare-conflict": [spec: { aId: string; bId: string }];
}>();

const folders = computed(() => props.vault.folders.value);
const notes = computed(() => props.vault.notes.value);

// Pairs restoreFromDrive left behind because a note diverged between
// devices (same day's entry created on both, or an edit on both sides
// between syncs) -- see notes.ts's restoreFromDrive/resolveConflict.
const conflictPairs = computed(() => {
  const pairs: { original: (typeof notes.value)[number]; copy: (typeof notes.value)[number] }[] = [];
  for (const copy of notes.value) {
    if (!copy.conflictOf) continue;
    const original = notes.value.find((n) => n.id === copy.conflictOf);
    if (original) pairs.push({ original, copy });
  }
  return pairs;
});

const currentFolder = computed(() => folders.value.find((f) => f.id === props.currentFolderId) ?? null);
const subfolders = computed(() => folders.value.filter((f) => f.parentId === props.currentFolderId));
const notesHere = computed(() => notes.value.filter((n) => n.folderId === props.currentFolderId));

const breadcrumb = computed(() => {
  const path: { id: string; name: string }[] = [];
  let node = currentFolder.value;
  while (node) {
    path.unshift({ id: node.id, name: node.name });
    node = folders.value.find((f) => f.id === node!.parentId) ?? null;
  }
  return path;
});

function open(folderId: string) {
  emit("update:currentFolderId", folderId);
}
function goUp() {
  if (currentFolder.value) emit("update:currentFolderId", currentFolder.value.parentId);
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function addDailyNote() {
  emit("open-note", { id: props.vault.todayNoteId() });
}

const showNewFolder = ref(false);
const newFolderName = ref("");
async function createFolder() {
  const name = newFolderName.value.trim();
  if (!name) return;
  await props.vault.createFolder(name, props.currentFolderId);
  newFolderName.value = "";
  showNewFolder.value = false;
}

const showAddNote = ref(false);
const newNoteTitle = ref("");
const newNoteFolderId = ref(props.currentFolderId);
function openAddNote() {
  newNoteTitle.value = "";
  newNoteFolderId.value = props.currentFolderId;
  showAddNote.value = true;
}
function folderPath(folderId: string): string {
  const path: string[] = [];
  let node = folders.value.find((f) => f.id === folderId) ?? null;
  while (node) {
    path.unshift(node.name);
    node = folders.value.find((f) => f.id === node!.parentId) ?? null;
  }
  return path.length ? path.join(" / ") : "(top level)";
}
function createNoteAndOpen() {
  const title = newNoteTitle.value.trim();
  if (!title) return;
  const id = crypto.randomUUID();
  showAddNote.value = false;
  emit("open-note", { id, folderId: newNoteFolderId.value, title });
}

async function renameFolderPrompt(id: string, current: string) {
  const name = window.prompt("Rename folder", current);
  if (name && name.trim()) await props.vault.renameFolder(id, name.trim());
}
async function deleteFolderPrompt(id: string, name: string) {
  if (!window.confirm(`Delete the empty folder "${name}"?`)) return;
  const ok = await props.vault.deleteFolder(id);
  if (!ok) window.alert("That folder isn't empty -- move or delete what's inside it first.");
}
</script>

<template>
  <div class="screen">
    <div class="top-bar">
      <div class="top-bar-inner">
        <button v-if="currentFolder" class="icon-btn" @click="goUp" aria-label="Up one folder">←</button>
        <h1>{{ currentFolder ? currentFolder.name : "Secure Notes" }}</h1>
        <button class="icon-btn" @click="emit('open-search')" aria-label="Search notes">🔎</button>
        <button class="icon-btn" @click="emit('open-settings')" aria-label="Settings">⚙</button>
      </div>
    </div>

    <div class="screen-body">
      <div v-if="breadcrumb.length > 1" style="font-size: 0.85rem; color: #666; margin-bottom: 0.75rem">
        <span v-for="(b, i) in breadcrumb" :key="b.id">
          <a href="#" @click.prevent="open(b.id)">{{ b.name }}</a>
          <span v-if="i < breadcrumb.length - 1"> / </span>
        </span>
      </div>

      <div v-if="conflictPairs.length" style="margin-bottom: 1rem">
        <div
          v-for="pair in conflictPairs"
          :key="pair.copy.id"
          style="background: #fff4e0; border: 1.5px solid var(--gold-dark); border-radius: 10px; padding: 0.6rem 0.75rem; margin-bottom: 0.5rem; display: flex; align-items: center; gap: 0.5rem"
        >
          <div style="flex: 1; font-size: 0.85rem">
            <strong>Two versions of "{{ pair.original.title || "Untitled" }}"</strong>
            <div style="color: #7a5b00">Synced from another device -- pick which to keep.</div>
          </div>
          <button class="btn btn-secondary" @click="emit('compare-conflict', { aId: pair.original.id, bId: pair.copy.id })">Compare</button>
        </div>
      </div>

      <div style="display: flex; gap: 0.5rem; margin-bottom: 1rem">
        <button v-if="!currentFolder" class="btn" style="flex: 1" @click="addDailyNote">＋ Daily entry</button>
        <button class="btn btn-secondary" style="flex: 1" @click="openAddNote">＋ New note</button>
      </div>

      <div v-if="subfolders.length" style="margin-bottom: 1rem">
        <div
          v-for="f in subfolders"
          :key="f.id"
          class="folder-row"
          style="display: flex; align-items: center; gap: 0.5rem; padding: 0.6rem 0.25rem; border-bottom: 1px solid var(--border); border-radius: 8px"
        >
          <button style="flex: 1; text-align: left; background: none; border: none; font: inherit; display: flex; gap: 0.5rem" @click="open(f.id)">
            <span>📁</span><span>{{ f.name }}</span>
          </button>
          <button class="icon-btn" style="width: 32px; height: 32px" @click="renameFolderPrompt(f.id, f.name)" aria-label="Rename folder">✎</button>
          <button class="icon-btn" style="width: 32px; height: 32px" @click="deleteFolderPrompt(f.id, f.name)" aria-label="Delete folder">🗑</button>
        </div>
      </div>

      <button class="btn-secondary btn" style="margin-bottom: 1rem" @click="showNewFolder = true">＋ New folder here</button>

      <div v-if="notesHere.length === 0 && subfolders.length === 0" style="color: #777; text-align: center; margin-top: 2rem">
        Nothing here yet.
      </div>

      <div v-for="n in notesHere" :key="n.id" class="note-row" style="padding: 0.7rem 0.25rem; border-bottom: 1px solid var(--border); border-radius: 8px; cursor: pointer" @click="emit('open-note', { id: n.id })">
        <div style="display: flex; justify-content: space-between; gap: 0.5rem">
          <strong>{{ n.title || "Untitled" }}</strong>
          <span v-if="n.pendingSync" title="Not yet synced to Drive">☁︎</span>
        </div>
        <div style="font-size: 0.8rem; color: #777">{{ formatDate(n.updatedAt) }}</div>
      </div>
    </div>

    <ModalDialog v-if="showNewFolder" title="New folder" @close="showNewFolder = false">
      <input v-model="newFolderName" class="field" placeholder="Folder name" autofocus @keyup.enter="createFolder" />
      <div style="display: flex; gap: 0.5rem; margin-top: 1rem">
        <button class="btn btn-secondary" style="flex: 1" @click="showNewFolder = false">Cancel</button>
        <button class="btn" style="flex: 1" @click="createFolder">Create</button>
      </div>
    </ModalDialog>

    <ModalDialog v-if="showAddNote" title="New note" @close="showAddNote = false">
      <label style="font-size: 0.85rem">Title</label>
      <input v-model="newNoteTitle" class="field" placeholder="Note title" autofocus style="margin: 0.35rem 0 0.75rem" />
      <label style="font-size: 0.85rem">Folder</label>
      <select v-model="newNoteFolderId" class="field" style="margin: 0.35rem 0">
        <option :value="ROOT_FOLDER_ID">(top level)</option>
        <option v-for="f in folders" :key="f.id" :value="f.id">{{ folderPath(f.id) }}</option>
      </select>
      <div style="display: flex; gap: 0.5rem; margin-top: 1rem">
        <button class="btn btn-secondary" style="flex: 1" @click="showAddNote = false">Cancel</button>
        <button class="btn" style="flex: 1" :disabled="!newNoteTitle.trim()" @click="createNoteAndOpen">Create</button>
      </div>
    </ModalDialog>
  </div>
</template>
