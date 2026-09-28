<script setup lang="ts">
import { ref, watch } from "vue";
import type { useVault } from "../composables/useVault";
import type { Note } from "../data/types";

const props = defineProps<{ vault: ReturnType<typeof useVault>; noteAId: string; noteBId: string }>();
const emit = defineEmits<{ back: [] }>();

const noteA = ref<Note | null>(null);
const noteB = ref<Note | null>(null);
const loaded = ref(false);
const resolving = ref(false);

async function load() {
  loaded.value = false;
  [noteA.value, noteB.value] = await Promise.all([props.vault.loadNote(props.noteAId), props.vault.loadNote(props.noteBId)]);
  loaded.value = true;
}
watch([() => props.noteAId, () => props.noteBId], load, { immediate: true });

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

async function keep(keepId: string, discardId: string) {
  const keepTitle = keepId === props.noteAId ? noteA.value?.title : noteB.value?.title;
  if (!window.confirm(`Keep this version${keepTitle ? ` of "${keepTitle}"` : ""} and permanently delete the other one?`)) return;
  resolving.value = true;
  await props.vault.resolveConflict(keepId, discardId);
  resolving.value = false;
  emit("back");
}
</script>

<template>
  <div class="screen">
    <div class="top-bar">
      <div class="top-bar-inner">
        <button class="icon-btn" @click="emit('back')" aria-label="Back">←</button>
        <h1>Compare versions</h1>
      </div>
    </div>

    <div v-if="loaded" class="screen-body">
      <p style="font-size: 0.85rem; color: #666; margin-top: 0">
        These diverged when syncing across devices. Review both, then keep the one you want -- the other is deleted for good, from this device and from Drive.
      </p>

      <div style="display: flex; flex-direction: column; gap: 1rem">
        <div v-for="(note, i) in [noteA, noteB]" :key="i" style="border: 1.5px solid var(--border); border-radius: 12px; padding: 0.85rem; background: white">
          <template v-if="note">
            <strong style="display: block">{{ note.title || "Untitled" }}</strong>
            <div style="font-size: 0.8rem; color: #777; margin-bottom: 0.5rem">Last edited {{ formatDate(note.updatedAt) }}</div>
            <div style="white-space: pre-wrap; max-height: 30vh; overflow-y: auto; font-size: 0.95rem; margin-bottom: 0.75rem">{{ note.body || "(empty)" }}</div>
            <button class="btn btn-block" :disabled="resolving" @click="keep(note.id, note.id === noteA?.id ? noteBId : noteAId)">Keep this version</button>
          </template>
          <p v-else style="color: #999">This version was already deleted or resolved elsewhere.</p>
        </div>
      </div>
    </div>
  </div>
</template>
