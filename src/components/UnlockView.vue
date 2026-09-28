<script setup lang="ts">
import { ref } from "vue";
import type { useVault } from "../composables/useVault";

const props = defineProps<{ vault: ReturnType<typeof useVault> }>();

const password = ref("");
const error = ref<string | null>(null);
const checking = ref(false);

async function submit() {
  checking.value = true;
  const ok = await props.vault.unlock(password.value);
  checking.value = false;
  if (!ok) {
    error.value = "Wrong password.";
    password.value = "";
  }
}
</script>

<template>
  <div class="screen" style="align-items: center; justify-content: center">
    <div class="screen-body" style="max-width: 420px">
      <div style="text-align: center; font-size: 2.5rem">🔒</div>
      <h1 style="text-align: center">Secure Notes is locked</h1>
      <p style="color: #555; text-align: center">Enter your master password to decrypt your notes.</p>

      <form @submit.prevent="submit" autocomplete="off">
        <input
          v-model="password"
          type="password"
          class="field"
          placeholder="Master password"
          autocomplete="current-password"
          autofocus
          @input="error = null"
        />
        <p v-if="error" class="error-text">{{ error }}</p>
        <button type="submit" class="btn btn-block" :disabled="checking || !password" style="margin-top: 1rem">
          {{ checking ? "Checking…" : "Unlock" }}
        </button>
      </form>
    </div>
  </div>
</template>
