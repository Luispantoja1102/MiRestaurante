<template>
  <section>
    <div v-if="isOwner" class="toolbar">
      <button type="button" class="btn primary" @click="dialog = true">Agregar persona</button>
    </div>

    <p v-if="loading" class="muted">Cargando…</p>
    <p v-else-if="err" class="err" role="alert">{{ err }}</p>
    <div v-else class="table-wrap">
      <table>
        <thead><tr><th>Persona</th><th>Rol</th><th>Último acceso</th><th v-if="isOwner"></th></tr></thead>
        <tbody>
          <tr v-for="m in team" :key="m.id">
            <td>
              <strong>{{ m.name }} {{ m.lastName }}</strong>
              <span v-if="m.disabled" class="pill suspended"> Desactivado</span>
              <div class="sub">{{ m.username }} · {{ m.email }}</div>
            </td>
            <td>
              <select v-if="isOwner && m.username !== me" :value="m.role" :aria-label="`Rol de ${m.name}`" @change="changeRole(m, $event.target.value)">
                <option value="partner_admin">Dueño</option>
                <option value="partner_staff">Asesor</option>
              </select>
              <span v-else class="pill">{{ m.roleName }}</span>
            </td>
            <td>{{ fmtAgo(m.lastLoginAt) }}</td>
            <td v-if="isOwner">
              <button v-if="m.username !== me" type="button" class="btn" :class="{ danger: !m.disabled }" @click="toggle(m)">
                {{ m.disabled ? "Reactivar" : "Desactivar" }}
              </button>
              <span v-else class="sub">Tú</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="actionErr" class="err" role="alert">{{ actionErr }}</p>

    <div v-if="dialog" class="scrim center" @click.self="dialog = false">
      <form class="dialog form" role="dialog" aria-modal="true" aria-label="Agregar persona" @submit.prevent="create">
        <h2>Agregar a tu equipo</h2>
        <div class="two">
          <label>Nombre<input v-model="draft.name" required minlength="2" /></label>
          <label>Apellido<input v-model="draft.lastName" /></label>
        </div>
        <label>Correo<input v-model="draft.email" type="email" required /></label>
        <div class="two">
          <label>Usuario<input v-model="draft.username" required pattern="[A-Za-z0-9._\-]{3,40}" autocomplete="off" /></label>
          <label>Contraseña inicial<input v-model="draft.password" type="password" required minlength="8" autocomplete="new-password" /></label>
        </div>
        <label>Rol<select v-model="draft.role"><option value="partner_staff">Asesor (atiende clientes)</option><option value="partner_admin">Dueño (ve el dinero)</option></select></label>
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
import { errorText, fmtAgo } from "../platform/format";

defineProps({ isOwner: Boolean });

const me = authStore.username;
const team = ref([]);
const loading = ref(true);
const err = ref("");
const actionErr = ref("");
const dialog = ref(false);
const saving = ref(false);
const formErr = ref("");
const blank = () => ({ name: "", lastName: "", email: "", username: "", password: "", role: "partner_staff" });
const draft = reactive(blank());

async function load() {
  try {
    team.value = await apiService.partnerTeam();
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
    await apiService.partnerCreateMember({ ...draft });
    Object.assign(draft, blank());
    dialog.value = false;
    await load();
  } catch (e) {
    formErr.value = errorText(e, "No se pudo crear a esa persona");
  } finally {
    saving.value = false;
  }
}

async function act(fn) {
  actionErr.value = "";
  try {
    await fn();
  } catch (e) {
    actionErr.value = errorText(e, "No se pudo completar la acción");
  }
  await load();
}

const toggle = (m) => act(() => apiService.partnerSetMemberActive(m.id, m.disabled));
const changeRole = (m, role) => act(() => apiService.partnerChangeRole(m.id, role));

onMounted(load);
</script>
