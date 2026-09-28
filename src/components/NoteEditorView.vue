<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import type { useVault } from "../composables/useVault";
import { ROOT_FOLDER_ID } from "../composables/useVault";

const props = defineProps<{
  vault: ReturnType<typeof useVault>;
  noteId: string;
  initialFolderId?: string;
  initialTitle?: string;
  /** Set when arriving from cross-file search -- opens the find bar pre-filled and jumps straight to the first match. */
  initialSearchQuery?: string;
}>();
const emit = defineEmits<{ back: [] }>();

const title = ref("");
const body = ref("");
const folderId = ref(ROOT_FOLDER_ID);
const noteExisted = ref(false);
const loaded = ref(false);

// -------- find within this note --------

const titleInputEl = ref<HTMLInputElement | null>(null);
const bodyTextareaEl = ref<HTMLTextAreaElement | null>(null);
const searchInputEl = ref<HTMLInputElement | null>(null);
const searchOpen = ref(false);
const searchQuery = ref("");
/** -1 means "matches are known but none has been jumped to yet" -- keeps typing in the search box from stealing focus into the title/body field on every keystroke (only an explicit next/prev/Enter does that). */
const matchIndex = ref(-1);

interface Match {
  field: "title" | "body";
  start: number;
}

const matches = computed<Match[]>(() => {
  const q = searchQuery.value.trim();
  if (!q) return [];
  const needle = q.toLowerCase();
  const results: Match[] = [];
  for (const [field, text] of [["title", title.value], ["body", body.value]] as const) {
    const hay = text.toLowerCase();
    let from = 0;
    while (true) {
      const idx = hay.indexOf(needle, from);
      if (idx === -1) break;
      results.push({ field, start: idx });
      from = idx + needle.length;
    }
  }
  return results;
});

function scrollToMatch(m: Match) {
  const el = m.field === "title" ? titleInputEl.value : bodyTextareaEl.value;
  if (!el) return;
  el.focus();
  el.setSelectionRange(m.start, m.start + searchQuery.value.length);
}

// Resets to "not yet jumped" on every query edit -- deliberately doesn't
// touch focus/selection here, since this fires on each keystroke and
// stealing focus back to the title/body field mid-type would eat the
// user's next keystrokes (see matchIndex's comment above).
watch(searchQuery, () => {
  matchIndex.value = -1;
});

function openSearch() {
  searchOpen.value = true;
  nextTick(() => searchInputEl.value?.focus());
}
function closeSearch() {
  searchOpen.value = false;
  searchQuery.value = "";
  matchIndex.value = -1;
}
function goNext() {
  if (matches.value.length === 0) return;
  matchIndex.value = matchIndex.value === -1 ? 0 : (matchIndex.value + 1) % matches.value.length;
  scrollToMatch(matches.value[matchIndex.value]);
}
function goPrev() {
  if (matches.value.length === 0) return;
  matchIndex.value = matchIndex.value === -1 ? matches.value.length - 1 : (matchIndex.value - 1 + matches.value.length) % matches.value.length;
  scrollToMatch(matches.value[matchIndex.value]);
}

function handleGlobalKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
    e.preventDefault();
    openSearch();
  }
}
onMounted(() => window.addEventListener("keydown", handleGlobalKeydown));
onUnmounted(() => window.removeEventListener("keydown", handleGlobalKeydown));

async function load() {
  loaded.value = false;
  closeSearch();
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

  if (props.initialSearchQuery) {
    searchOpen.value = true;
    searchQuery.value = props.initialSearchQuery;
    await nextTick();
    goNext();
  }
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
        <button class="icon-btn" @click="searchOpen ? closeSearch() : openSearch()" aria-label="Find in note">🔎</button>
        <button v-if="noteExisted" class="icon-btn" @click="deleteAndLeave" aria-label="Delete note">🗑</button>
        <button class="icon-btn" @click="saveAndLeave" aria-label="Save">✓</button>
      </div>
      <div v-if="searchOpen" class="top-bar-inner" style="padding-top: 0; gap: 0.4rem">
        <input
          ref="searchInputEl"
          v-model="searchQuery"
          class="field"
          style="min-height: 36px; padding: 0.4rem 0.75rem"
          placeholder="Find in note"
          @keydown.enter.prevent="$event.shiftKey ? goPrev() : goNext()"
          @keydown.escape.prevent="closeSearch"
        />
        <span style="font-size: 0.8rem; color: #666; white-space: nowrap; min-width: 3.5rem; text-align: center">
          {{ matches.length ? `${(matchIndex === -1 ? 0 : matchIndex) + 1}/${matches.length}` : searchQuery.trim() ? "0/0" : "" }}
        </span>
        <button class="icon-btn" style="width: 32px; height: 32px" @click="goPrev" aria-label="Previous match">↑</button>
        <button class="icon-btn" style="width: 32px; height: 32px" @click="goNext" aria-label="Next match">↓</button>
        <button class="icon-btn" style="width: 32px; height: 32px" @click="closeSearch" aria-label="Close search">✕</button>
      </div>
    </div>

    <div v-if="loaded" class="screen-body" style="display: flex; flex-direction: column; flex: 1">
      <input ref="titleInputEl" v-model="title" class="editor-title" placeholder="Title" />
      <textarea ref="bodyTextareaEl" v-model="body" class="editor-body" placeholder="Write your note…" />
    </div>
  </div>
</template>
