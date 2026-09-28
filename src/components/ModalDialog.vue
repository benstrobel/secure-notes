<script setup lang="ts">
defineProps<{ title: string }>();
defineEmits<{ close: [] }>();
</script>

<template>
  <div class="modal-backdrop" @click.self="$emit('close')">
    <div class="modal-card">
      <h2>{{ title }}</h2>
      <slot />
    </div>
  </div>
</template>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(27, 36, 48, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  z-index: 20;
}
.modal-card {
  background: white;
  border-radius: 14px;
  padding: 1.25rem;
  width: 100%;
  max-width: 400px;
  max-height: 90vh;
  overflow-y: auto;
}
.modal-card h2 {
  margin-top: 0;
  font-size: 1.1rem;
}
</style>
