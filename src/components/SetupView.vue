<script setup lang="ts">
import { ref } from "vue";
import type { useVault } from "../composables/useVault";

const props = defineProps<{ vault: ReturnType<typeof useVault> }>();

const MIN_LENGTH = 8;
const password = ref("");
const confirm = ref("");
const error = ref<string | null>(null);
const creating = ref(false);

async function submit() {
  if (password.value.length < MIN_LENGTH) {
    error.value = `Use at least ${MIN_LENGTH} characters.`;
    return;
  }
  if (password.value !== confirm.value) {
    error.value = "Passwords don't match.";
    return;
  }
  creating.value = true;
  await props.vault.setUpVault(password.value);
}
</script>

<template>
  <div class="screen" style="align-items: center; justify-content: center">
    <div class="screen-body" style="max-width: 420px">
      <div style="text-align: center; font-size: 2.5rem">🔒</div>
      <h1 style="text-align: center">Welcome to Secure Notes</h1>
      <p style="color: #555">
        Choose a master password. It encrypts every note as a real password-protected Word document, and you'll need it every
        time you open the app -- there is no password recovery, so make sure you'll remember it.
      </p>

      <form @submit.prevent="submit" autocomplete="off">
        <label for="password">Master password</label>
        <input
          id="password"
          v-model="password"
          type="password"
          class="field"
          style="margin: 0.35rem 0 0.75rem"
          autocomplete="new-password"
          @input="error = null"
        />
        <label for="confirm">Confirm password</label>
        <input
          id="confirm"
          v-model="confirm"
          type="password"
          class="field"
          style="margin: 0.35rem 0 0.75rem"
          autocomplete="new-password"
          @input="error = null"
        />

        <p v-if="error" class="error-text">{{ error }}</p>

        <button type="submit" class="btn btn-block" :disabled="creating" style="margin-top: 0.5rem">
          {{ creating ? "Creating…" : "Create My Vault" }}
        </button>
      </form>
    </div>
  </div>
</template>
