<template>
  <section>
    <div class="toolbar">
      <button type="button" class="btn primary" @click="dialog = true">Agregar persona</button>
    </div>

    <p v-if="loading" class="muted">Cargando…</p>
    <p v-else-if="err" class="err">{{ err }}</p>
    <div v-else class="table-wrap">
      <table>
        <thead>
          <tr><th>Persona</th><th>Rol</th><th>Último acceso</th><th>Alta</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="p in staff" :key="p.id">
            <td>
              <strong>{{ p.name }} {{ p.lastName }}</strong>
              <div class="sub">{{ p.username }} · {{ p.email }}</div>
            </td>
            <td><span class="pill">{{ p.roleName }}</span></td>
            <td>{{ fmtAgo(p.lastLoginAt) }}</td>
            <td>{{ fmtDate(p.createdAt) }}</td>
            <td>
              <button v-if="p.username !== me" type="button" class="btn danger" @click="remove(p)">Quitar</button>
              <span v-else class="sub">Tú</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="actionErr" class="err" role="alert">{{ actionErr }}</p>

    <div v-if="dialog" class="scrim center" @click.self="dialog = false">
      <form class="dialog form" role="dialog" aria-modal="true" aria-label="Agregar persona" @submit.prevent="create">
        <h2>Agregar al equipo</h2>
        <div class="two">
          <label>Nombre<input v-model="draft.name" required minlength="2" /></label>
          <label>Apellido<input v-model="draft.lastName" required /></label>
        </div>
        <label>Correo<input v-model="draft.email" type="email" required /></label>
        <div class="two">
          <label>Usuario<input v-model="draft.username" required pattern="[A-Za-z0-9._\-]{3,30}" autocomplete="off" /></label>
          <label>Contraseña<input v-model="draft.password" type="password" required minlength="8" autocomplete="new-password" /></label>
        </div>
        <label>
          Rol
          <select v-model="draft.role">
            <option value="platform_support">Soporte (consulta clientes)</option>
            <option value="platform_admin">Admin (gestiona todo)</option>
          </select>
        </label>
        <p v-if="formErr" class="err" role="alert">{{ formErr }}</p>
        <div class="actions">
          <button type="submit" class="btn primary" :disabled="saving">{{ saving ? "Creando…" : "Crear" }}</button>
          <button type="button" class="btn" @click="dialog = false">Cancelar</button>
        </div>
      </form>
    </div>
  </section>
</template>

<script setup>
import { onMounted, reactive, ref } from "vue";
import { apiService } from "../../apiService";
import { authStore } from "../../authStore";
import { errorText, fmtAgo, fmtDate } from "./format";

const me = authStore.username;
const staff = ref([]);
const loading = ref(true);
const err = ref("");
const actionErr = ref("");
const dialog = ref(false);
const saving = ref(false);
const formErr = ref("");
const blank = () => ({ name: "", lastName: "", email: "", username: "", password: "", role: "platform_support" });
const draft = reactive(blank());

async function load() {
  try {
    staff.value = await apiService.platformListStaff();
  } catch (e) {
    err.value = errorText(e, "No se pudo cargar el equipo");
  } finally {
    loading.value = false;
  }
}

async function create() {
  saving.value = true;
  formErr.value = "";
  try {
    await apiService.platformCreateStaff({ ...draft });
    Object.assign(draft, blank());
    dialog.value = false;
    await load();
  } catch (e) {
    formErr.value = errorText(e, "No se pudo crear a esa persona");
  } finally {
    saving.value = false;
  }
}

async function remove(p) {
  if (!window.confirm(`¿Quitar a ${p.name} ${p.lastName} del equipo?`)) return;
  actionErr.value = "";
  try {
    await apiService.platformDeleteStaff(p.id);
    await load();
  } catch (e) {
    actionErr.value = errorText(e, "No se pudo quitar a esa persona");
  }
}

onMounted(load);
</script>
