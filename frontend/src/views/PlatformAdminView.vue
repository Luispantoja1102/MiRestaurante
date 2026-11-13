<template>
  <div class="platform">
    <header class="head">
      <div>
        <p class="brand">MiRestaurante Platform</p>
        <h1>{{ title }}</h1>
      </div>
      <div class="actions">
        <span class="pill">{{ isAdmin ? "Admin" : "Soporte" }}</span>
        <button type="button" class="btn" @click="logout">Salir</button>
      </div>
    </header>

    <nav class="tabs" aria-label="Secciones de la plataforma">
      <button v-for="t in tabs" :key="t.id" type="button" class="tab" :class="{ on: tab === t.id }" @click="tab = t.id">
        {{ t.label }}
      </button>
    </nav>

    <PlatformToday v-if="tab === 'today'" @open="openClient" @support="tab = 'support'" />
    <PlatformClients v-else-if="tab === 'clients'" :can-edit="isAdmin" :focus-id="focusId" />
    <PlatformSupport v-else-if="tab === 'support'" />
    <PlatformFinance v-else-if="tab === 'finance'" />
    <PlatformReferrers v-else-if="tab === 'referrers'" />
    <PlatformTeam v-else-if="tab === 'team'" />
  </div>
</template>

<script setup>
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { clearSession, isPlatformAdmin } from "../authStore";
import PlatformClients from "../components/platform/PlatformClients.vue";
import PlatformFinance from "../components/platform/PlatformFinance.vue";
import PlatformSupport from "../components/platform/PlatformSupport.vue";
import PlatformReferrers from "../components/platform/PlatformReferrers.vue";
import PlatformToday from "../components/platform/PlatformToday.vue";
import PlatformTeam from "../components/platform/PlatformTeam.vue";
import "../platform.css";

const router = useRouter();
const isAdmin = isPlatformAdmin();

// Soporte atiende clientes y tickets; el resumen, las finanzas, los referidos y el equipo son del admin
const tabs = isAdmin
  ? [
      { id: "today", label: "Hoy" },
      { id: "clients", label: "Clientes" },
      { id: "support", label: "Soporte" },
      { id: "finance", label: "Finanzas" },
      { id: "referrers", label: "Referidos" },
      { id: "team", label: "Equipo" },
    ]
  : [
      { id: "clients", label: "Clientes" },
      { id: "support", label: "Soporte" },
    ];

const tab = ref(tabs[0].id);
const focusId = ref("");
const title = computed(() => tabs.find((t) => t.id === tab.value)?.label || "Plataforma");

function openClient(id) {
  focusId.value = id;
  tab.value = "clients";
}

function logout() {
  clearSession();
  router.push("/login");
}
</script>
