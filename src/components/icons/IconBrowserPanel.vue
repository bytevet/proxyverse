<script setup lang="ts">
// A browser window with a panel: dropping from its toolbar (the popup) or
// docked on the right (the sidebar). Drawn on Arco's icon grid and style.
defineProps<{ panel: "popup" | "sidebar" }>();

const WINDOW =
  "M42 10a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v28a2 2 0 0 0 2 2h32a2 2 0 0 0 2-2V10ZM6 16h36";
const PANEL = {
  popup: "M24 16v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V16",
  sidebar: "M29 16v24",
};
</script>

<template>
  <svg
    class="arco-icon"
    viewBox="0 0 48 48"
    fill="none"
    stroke="currentColor"
    stroke-width="4"
    stroke-linecap="butt"
    stroke-linejoin="miter"
    aria-hidden="true"
  >
    <path :d="WINDOW + PANEL[panel]" />
  </svg>
</template>
