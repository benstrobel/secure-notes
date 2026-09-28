<script setup lang="ts">
import { ref, watch } from "vue";
import type { useVault } from "../composables/useVault";
import { ROOT_FOLDER_ID } from "../composables/useVault";

const props = defineProps<{
  vault: ReturnType<typeof useVault>;
  noteId: string;
  initialFolderId?: string;
  initialTitle?: string;
}>();
const emit = defineEmits<{ back: [] }>();

const title = ref("");
const body = ref("");
const folderId = ref(ROOT_FOLDER_ID);
const noteExisted = ref(false);
const loaded = ref(false);

async function load() {
  loaded.value = false;
  const existing = await props.vault.loadNote(props.noteId);
  if (existing) {
    title.value = existing.title;
    body.value = existing.body;
    folderId.value = existing.folderId;
    noteExisted.value = true;
  } else if (props.initialFolderId) {
    title.value = props.initialTitle ?? "";
    body.value = "";
    folderId.value = props.initialFolderId;
    noteExisted.value = false;
  } else if (props.vault.isDailyId(props.noteId)) {
    title.value = props.vault.suggestedTitleForDailyId(props.noteId);
    body.value = "";
    folderId.value = await props.vault.dailyFolderId();
    noteExisted.value = false;
  } else {
    title.value = "";
    body.value = "";
    folderId.value = ROOT_FOLDER_ID;
    noteExisted.value = false;
  }
  loaded.value = true;
}
watch(() => props.noteId, load, { immediate: true });

async function saveAndLeave() {
  const hasSomethingToSave = noteExisted.value ? title.value.trim() !== "" || body.value.trim() !== "" : body.value.trim() !== "";
  if (hasSomethingToSave) {
    await props.vault.saveNote(props.noteId, folderId.value, title.value, body.value);
  }
  emit("back");
}

async function deleteAndLeave() {
  if (!window.confirm("Delete this note?")) return;
  await props.vault.deleteNote(props.noteId);
  emit("back");
}
</script>

<template>
  <div class="screen">
    <div class="top-bar">
      <div class="top-bar-inner">
        <button class="icon-btn" @click="saveAndLeave" aria-label="Save and go back">←</button>
        <h1>{{ noteExisted ? "Edit note" : "New note" }}</h1>
        <button v-if="noteExisted" class="icon-btn" @click="deleteAndLeave" aria-label="Delete note">🗑</button>
        <button class="icon-btn" @click="saveAndLeave" aria-label="Save">✓</button>
      </div>
    </div>

    <div v-if="loaded" class="screen-body" style="display: flex; flex-direction: column; flex: 1">
      <input v-model="title" class="editor-title" placeholder="Title" />
      <textarea v-model="body" class="editor-body" placeholder="Write your note…" />
    </div>
  </div>
</template>
