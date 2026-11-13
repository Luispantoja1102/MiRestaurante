<template>
  <div class="platform">
    <header class="head">
      <div>
        <p class="brand">MiRestaurante Socios</p>
        <h1>{{ title }}</h1>
      </div>
      <div class="actions">
        <span class="pill">{{ isOwner ? "Dueño" : "Asesor" }}</span>
        <button type="button" class="btn" @click="logout">Salir</button>
      </div>
    </header>

    <nav class="tabs" aria-label="Secciones del portal">
      <button v-for="t in tabs" :key="t.id" type="button" class="tab" :class="{ on: tab === t.id }" @click="tab = t.id">{{ t.label }}</button>
    </nav>

    <PartnerHome v-if="tab === 'home'" :is-owner="isOwner" @open="openClient" />
    <PartnerClients v-else-if="tab === 'clients'" :is-owner="isOwner" :focus-id="focusId" />
    <PartnerCommissions v-else-if="tab === 'commissions'" />
    <PartnerTeam v-else-if="tab === 'team'" :is-owner="isOwner" />
  </div>
</template>

<script setup>
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { authStore, clearSession } from "../authStore";
import PartnerClients from "../components/partner/PartnerClients.vue";
import PartnerCommissions from "../components/partner/PartnerCommissions.vue";
import PartnerHome from "../components/partner/PartnerHome.vue";
import PartnerTeam from "../components/partner/PartnerTeam.vue";
import "../platform.css";

const router = useRouter();
const isOwner = authStore.role === "partner_admin";

// El dinero y el equipo son del dueño; el asesor atiende negocios
const tabs = [
  { id: "home", label: "Inicio" },
  { id: "clients", label: "Mis clientes" },
  ...(isOwner ? [{ id: "commissions", label: "Comisiones" }] : []),
  { id: "team", label: "Equipo" },
];
const tab = ref("home");
const focusId = ref("");
const title = computed(() => tabs.find((t) => t.id === tab.value)?.label || "Portal");

function openClient(id) {
  focusId.value = id;
  tab.value = "clients";
}

function logout() {
  clearSession();
  router.push("/login");
}
</script>
