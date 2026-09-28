<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import type { useVault } from "../composables/useVault";
import type { SearchEntry } from "../data/notes";

const props = defineProps<{ vault: ReturnType<typeof useVault> }>();
const emit = defineEmits<{
  back: [];
  "open-note": [spec: { id: string; searchQuery: string }];
}>();

const folders = computed(() => props.vault.folders.value);

const indexing = ref(true);
const progressDone = ref(0);
const progressTotal = ref(0);
const entries = ref<SearchEntry[]>([]);
const query = ref("");

onMounted(async () => {
  entries.value = await props.vault.buildSearchIndex((done, total) => {
    progressDone.value = done;
    progressTotal.value = total;
  });
  indexing.value = false;
});

function folderPath(folderId: string): string {
  const path: string[] = [];
  let node = folders.value.find((f) => f.id === folderId) ?? null;
  while (node) {
    path.unshift(node.name);
    node = folders.value.find((f) => f.id === node!.parentId) ?? null;
  }
  return path.length ? path.join(" / ") : "(top level)";
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

interface Snippet {
  pre: string;
  match: string;
  post: string;
}

/** First match in the body, with a little surrounding context -- null if the match is only in the title (nothing useful to show below it) or there's no match at all. */
function snippetFor(entry: SearchEntry, needle: string): Snippet | null {
  const hay = entry.body.toLowerCase();
  const idx = hay.indexOf(needle);
  if (idx === -1) return null;
  const start = Math.max(0, idx - 40);
  const end = Math.min(entry.body.length, idx + needle.length + 80);
  return {
    pre: (start > 0 ? "…" : "") + entry.body.slice(start, idx),
    match: entry.body.slice(idx, idx + needle.length),
    post: entry.body.slice(idx + needle.length, end) + (end < entry.body.length ? "…" : ""),
  };
}

const results = computed(() => {
  const needle = query.value.trim().toLowerCase();
  if (!needle) return [];
  return entries.value
    .map((entry) => ({ entry, snippet: snippetFor(entry, needle) }))
    .filter(({ entry, snippet }) => snippet !== null || entry.title.toLowerCase().includes(needle))
    .sort((a, b) => b.entry.updatedAt - a.entry.updatedAt);
});

function openResult(id: string) {
  emit("open-note", { id, searchQuery: query.value.trim() });
}
</script>

<template>
  <div class="screen">
    <div class="top-bar">
      <div class="top-bar-inner">
        <button class="icon-btn" @click="emit('back')" aria-label="Back">←</button>
        <h1>Search notes</h1>
      </div>
    </div>

    <div class="screen-body">
      <div v-if="indexing" style="padding: 1rem 0">
        <p style="font-size: 0.9rem; color: #666; margin-bottom: 0.5rem">
          Decrypting notes to search{{ progressTotal ? ` (${progressDone}/${progressTotal})` : "…" }}
        </p>
        <div style="height: 8px; border-radius: 999px; background: var(--paper-dim); overflow: hidden">
          <div
            style="height: 100%; background: var(--gold); border-radius: 999px; transition: width 0.15s"
            :style="{ width: (progressTotal ? (progressDone / progressTotal) * 100 : 0) + '%' }"
          ></div>
        </div>
      </div>

      <template v-else>
        <input v-model="query" class="field" placeholder="Search across all notes" autofocus style="margin-bottom: 1rem" />

        <div v-if="query.trim() && results.length === 0" style="color: #777; text-align: center; margin-top: 2rem">
          No matches.
        </div>

        <div
          v-for="{ entry, snippet } in results"
          :key="entry.id"
          class="note-row"
          style="padding: 0.7rem 0.25rem; border-bottom: 1px solid var(--border); border-radius: 8px; cursor: pointer"
          @click="openResult(entry.id)"
        >
          <div style="display: flex; justify-content: space-between; gap: 0.5rem">
            <strong>{{ entry.title || "Untitled" }}</strong>
            <span style="font-size: 0.8rem; color: #777; white-space: nowrap">{{ formatDate(entry.updatedAt) }}</span>
          </div>
          <div style="font-size: 0.8rem; color: #777; margin-bottom: 0.15rem">{{ folderPath(entry.folderId) }}</div>
          <div v-if="snippet" style="font-size: 0.85rem; color: #444">
            {{ snippet.pre }}<mark style="background: var(--gold); border-radius: 3px">{{ snippet.match }}</mark>{{ snippet.post }}
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
