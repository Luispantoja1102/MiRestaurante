<template>
  <AppShell>
    <div class="settings cfg-layout" :class="{ 'section-open': Boolean(section) }">
      <!-- Menú de secciones -->
      <nav class="cfg-nav" aria-label="Secciones de ajustes">
        <header class="cfg-nav-head">
          <h1>Ajustes</h1>
          <p>{{ venueStore.businessName || "Tu negocio" }}</p>
        </header>

        <div v-for="g in NAV" :key="g.title" class="cfg-group">
          <h2>{{ g.title }}</h2>
          <template v-for="item in g.items" :key="item.id">
            <router-link v-if="item.to" :to="item.to" class="cfg-item">
              <span class="cfg-ico" v-html="ICONS[item.icon]"></span>
              <span class="cfg-txt"><strong>{{ item.label }}</strong><small>{{ item.desc }}</small></span>
              <span class="cfg-chev" aria-hidden="true">›</span>
            </router-link>
            <button v-else type="button" class="cfg-item" :class="{ on: section === item.id }" :aria-current="section === item.id ? 'page' : undefined" @click="open(item.id)">
              <span class="cfg-ico" v-html="ICONS[item.icon]"></span>
              <span class="cfg-txt"><strong>{{ item.label }}</strong><small>{{ item.desc }}</small></span>
              <span class="cfg-chev" aria-hidden="true">›</span>
            </button>
          </template>
        </div>

        <button type="button" class="cfg-item logout" @click="logout">
          <span class="cfg-ico" v-html="ICONS.logout"></span>
          <span class="cfg-txt"><strong>Cerrar sesión</strong><small>{{ authStore.username ? `Entraste como ${authStore.username}` : "Salir de este dispositivo" }}</small></span>
        </button>
      </nav>

      <!-- Contenido de la sección -->
      <main v-if="section" class="cfg-main">
        <header class="cfg-sec-head">
          <button type="button" class="cfg-back" aria-label="Volver a Ajustes" @click="section = ''">‹</button>
          <div>
            <h2>{{ current.label }}</h2>
            <p>{{ current.lead }}</p>
          </div>
        </header>

        <!-- Mi negocio -->
        <section v-if="section === 'negocio'" class="panel">
          <div class="form-grid">
            <label>Nombre<input v-model="form.businessName" maxlength="80" /></label>
            <label>Tipo de establecimiento
              <select v-model="form.businessType">
                <option value="restaurant">Restaurante</option>
                <option value="cafe">Café</option>
                <option value="bar">Bar</option>
                <option value="hotel">Hotel</option>
                <option value="other">Otro</option>
              </select>
            </label>
            <label>Dirección<input v-model="form.address" maxlength="200" /></label>
            <label>Teléfono<input v-model="form.phone" maxlength="30" /></label>
            <LogoPicker
              v-model:logo-url="form.logoUrl"
              v-model:primary-color="form.primaryColor"
              v-model:accent-color="form.accentColor"
              hint="Paleta de tu logo (se guarda con «Guardar cambios»)"
            />
            <label>Zona horaria
              <select v-model="form.timezone">
                <option value="America/Mexico_City">Ciudad de México</option>
                <option value="America/Tijuana">Tijuana</option>
                <option value="America/Monterrey">Monterrey</option>
                <option value="America/Cancun">Cancún</option>
                <option value="America/Bogota">Bogotá</option>
                <option value="America/Lima">Lima</option>
                <option value="America/Santiago">Santiago</option>
                <option value="America/Argentina/Buenos_Aires">Buenos Aires</option>
                <option value="Europe/Madrid">Madrid</option>
              </select>
            </label>
          </div>
          <button type="button" class="btn-primary" :disabled="saving" @click="saveBrand">{{ saving ? "Guardando…" : "Guardar cambios" }}</button>
        </section>

        <!-- Cómo trabajas -->
        <section v-else-if="section === 'operacion'" class="panel">
          <p class="hint">Define qué roles puede tener tu equipo y qué pantallas ve cada uno. Cada rol puede tener varias personas, cada una con su cuenta.</p>
          <FocusPicker v-model="form.serviceFocus" :disabled="saving" />
          <p class="hint">
            Si cambias a una opción con menos roles, primero elimina o cambia las cuentas que ya no caben (se avisa al guardar).
          </p>
          <label v-if="hasTables" class="inline-field">Mesas iniciales (referencia)
            <input v-model.number="form.initialTables" type="number" min="0" max="100" />
          </label>
          <p v-else class="hint">Solo para llevar no usa mesas: se vende desde el Mostrador.</p>
          <button type="button" class="btn-primary" :disabled="saving || !form.serviceFocus" @click="saveBrand">{{ saving ? "Guardando…" : "Guardar" }}</button>
          <router-link to="/setup" class="link">Volver a ejecutar el asistente de configuración</router-link>
        </section>

        <!-- Invitaciones -->
        <section v-else-if="section === 'equipo'" class="panel">
          <p class="hint">
            Se envía un correo con un enlace para unirse. ¿Sin correo? Crea la cuenta directo en
            <router-link to="/team">Cuentas y roles</router-link>.
          </p>
          <form class="invite-form" @submit.prevent="sendInvite">
            <label>Correo<input v-model="invite.email" type="email" required placeholder="persona@negocio.com" /></label>
            <label>Rol
              <select v-model="invite.role">
                <option v-for="r in inviteRoles" :key="r.id" :value="r.id">{{ r.label }}</option>
              </select>
            </label>
            <button type="submit" class="btn-primary" :disabled="inviting">{{ inviting ? "Enviando…" : "Enviar invitación" }}</button>
          </form>
          <p v-if="inviteMsg" class="ok" role="status">{{ inviteMsg }}</p>
          <p v-if="inviteErr" class="err" role="alert">{{ inviteErr }}</p>

          <h3>Invitaciones</h3>
          <ul class="invite-list">
            <li v-for="i in invites" :key="i.id">
              <div>
                <strong>{{ i.email }}</strong>
                <span class="meta">{{ roleText(i.role) }} · {{ inviteText(i.status) }}</span>
              </div>
              <div class="row-actions">
                <button v-if="i.status === 'pending'" type="button" @click="revoke(i)">Revocar</button>
                <button type="button" class="danger" @click="removeInvite(i)">Eliminar</button>
              </div>
            </li>
            <li v-if="!invites.length" class="empty">Sin invitaciones aún.</li>
          </ul>
        </section>

        <!-- Uber Eats -->
        <section v-else-if="section === 'integraciones'" class="panel">
          <p class="hint">
            Los pedidos de Uber Eats llegan solos a la pantalla de Caja. Tú los aceptas o rechazas ahí; si nadie responde en
            unos 11 minutos, Uber los cancela.
          </p>
          <p v-if="uber.loaded && !uber.configured" class="err" role="alert">
            El servidor todavía no tiene las credenciales de Uber Eats. Quien administra la plataforma debe configurarlas
            antes de que lleguen pedidos.
          </p>
          <p v-else-if="uber.loaded" class="hint">
            Conexión: <strong>{{ uber.environment === 'production' ? 'Producción' : 'Pruebas (sandbox)' }}</strong>
          </p>

          <UberConnect v-if="uber.loaded && uber.configured" :uber="uber" :choose="uberChoose" @changed="loadUber" @message="(m) => { message = m; messageIsError = false; }" />

          <details class="uber-manual" :open="uber.loaded && !uber.oauth">
            <summary>Vincular con el Store ID (avanzado)</summary>
            <form class="pass-form" @submit.prevent="linkUber">
              <label>Store ID de tu tienda en Uber Eats
                <input v-model.trim="uber.storeInput" type="text" maxlength="64" autocomplete="off" spellcheck="false" placeholder="Pega aquí el Store ID" required />
              </label>
              <button type="submit" class="btn-primary" :disabled="uber.busy">{{ uber.storeId ? "Cambiar tienda" : "Vincular tienda" }}</button>
            </form>
          </details>
          <p v-if="uber.storeId" class="ok" role="status">
            Vinculada: <strong v-if="uber.storeName">{{ uber.storeName }}</strong> <code>{{ uber.storeId }}</code>
            <button type="button" class="link-btn" :disabled="uber.busy" @click="unlinkUber">Desvincular</button>
          </p>

          <UberStoreStatus v-if="uber.storeId" show-auto />
          <UberMenu v-if="uber.storeId" />
          <UberMetrics v-if="uber.storeId" />
          <p v-if="uber.error" class="err" role="alert">{{ uber.error }}</p>
        </section>

        <!-- Terminal de cobro -->
        <section v-else-if="section === 'terminal'" class="panel">
          <p class="hint">
            Cobra con tarjeta en tu terminal Point de Mercado Pago: Caja le manda el monto y la venta solo se registra si el pago se
            aprueba. Si usas otra terminal, «Tarjeta» sigue funcionando registrada a mano.
          </p>
          <p v-if="pt.loaded && !pt.available" class="err" role="alert">
            El servidor todavía no tiene la conexión con Mercado Pago. Quien administra la plataforma debe configurarla.
          </p>
          <template v-else-if="pt.loaded">
            <button v-if="!pt.connected" type="button" class="btn-primary" :disabled="pt.busy" @click="connectPoint">Conectar mi cuenta de Mercado Pago</button>
            <template v-else>
              <p class="ok" role="status">
                Cuenta de Mercado Pago conectada.
                <button type="button" class="link-btn" :disabled="pt.busy" @click="disconnectPoint">Desconectar</button>
              </p>
              <ul v-if="pt.terminals.length" class="term-list">
                <li v-for="t in pt.terminals" :key="t.id">
                  <form class="term-row" @submit.prevent="renameTerminal(t)">
                    <label>Nombre interno <small>({{ t.label }})</small>
                      <input v-model="pt.names[t.id]" maxlength="40" required />
                    </label>
                    <button type="submit" class="btn-primary" :disabled="pt.busy || !pt.names[t.id]?.trim() || pt.names[t.id].trim() === t.name">Guardar</button>
                    <button type="button" class="link-btn" :disabled="pt.busy" @click="removeTerminal(t)">Quitar</button>
                  </form>
                  <p v-if="t.ok" class="ok" role="status">{{ t.name }}: lista</p>
                  <p v-else class="err" role="alert">{{ t.name }}: {{ t.message }}</p>
                </li>
              </ul>
              <form v-if="freeTerminals.length" class="pass-form" @submit.prevent="pickTerminal">
                <label>{{ pt.terminals.length ? "Agregar otra terminal" : "Tu terminal" }}
                  <select v-model="pt.pick" required>
                    <option value="" disabled>Elige tu terminal</option>
                    <option v-for="t in freeTerminals" :key="t.id" :value="t.id">{{ t.external_pos_id || t.id }}</option>
                  </select>
                </label>
                <label>Nombre interno (opcional)
                  <input v-model="pt.newName" maxlength="40" placeholder="Barra, Terraza, Caja 2…" />
                </label>
                <button type="submit" class="btn-primary" :disabled="pt.busy || !pt.pick">Usar esta terminal</button>
              </form>
              <p v-else-if="!pt.account.length" class="hint">No encontramos terminales en tu cuenta. Vincúlala primero desde la app de Mercado Pago.</p>
              <p v-if="pt.terminals.length > 1" class="hint">Al cobrar, Caja y el mostrador te dejan elegir en cuál terminal se cobra.</p>
            </template>
          </template>
          <p v-if="pt.error" class="err" role="alert">{{ pt.error }}</p>
        </section>

        <!-- Impresora (se guarda solo en este dispositivo) -->
        <template v-else-if="section === 'impresora'">
          <section class="panel pr-card">
            <h3>Cómo sale el ticket</h3>
            <p class="hint">Se guarda solo en este dispositivo: cada caja elige su impresora. No necesita «Guardar cambios».</p>
            <div class="pr-choices">
              <button
                v-for="m in PRINTER_MODES"
                :key="m.id"
                type="button"
                class="pr-choice"
                :aria-pressed="printerStore.mode === m.id"
                :disabled="m.id !== 'browser' && !printerSupport()[m.id]"
                @click="setPrinterMode(m.id)"
              >
                <strong>{{ m.label }}</strong>
                <small>{{ m.id !== "browser" && !printerSupport()[m.id] ? "Este navegador no lo permite. Usa Chrome o Edge." : m.hint }}</small>
              </button>
            </div>
          </section>

          <section v-if="printerStore.mode !== 'browser'" class="panel pr-card">
            <h3>Impresora térmica</h3>
            <p class="pr-state" :class="printerStore.connected ? 'on' : printerStore.lost ? 'lost' : 'off'" role="status"><i></i>{{ printerLine }}</p>
            <div class="pr-choices">
              <button type="button" class="pr-choice" :aria-pressed="printerStore.paper === '80'" @click="savePrinterSettings({ paper: '80' })">
                <strong>Papel 80 mm</strong><small>42 letras por renglón</small>
              </button>
              <button type="button" class="pr-choice" :aria-pressed="printerStore.paper === '58'" @click="savePrinterSettings({ paper: '58' })">
                <strong>Papel 58 mm</strong><small>32 letras por renglón</small>
              </button>
            </div>
            <label v-if="printerStore.mode === 'serial'" class="field">
              <span>Velocidad del puerto</span>
              <select :value="printerStore.baudRate" @change="savePrinterSettings({ baudRate: Number($event.target.value) })">
                <option v-for="b in [9600, 19200, 38400, 57600, 115200]" :key="b" :value="b">{{ b }}</option>
              </select>
            </label>
            <div class="pr-acts">
              <button type="button" class="btn-primary" :disabled="printerStore.busy" @click="choosePrinter">{{ printerStore.deviceName ? "Cambiar impresora" : "Elegir impresora" }}</button>
              <button type="button" class="pr-btn" :disabled="printerStore.busy || !printerStore.connected" @click="testPrint">{{ printerStore.busy ? "Imprimiendo…" : "Imprimir prueba" }}</button>
              <button type="button" class="pr-btn" :disabled="printerStore.busy || !printerStore.connected" @click="pulseDrawer">Abrir cajón</button>
            </div>
            <p v-if="printerErr" class="err" role="alert">{{ printerErr }}</p>
          </section>

          <section v-if="printerStore.mode !== 'browser'" class="panel pr-card">
            <h3>Diseño de la cuenta</h3>
            <div class="pr-choices">
              <button type="button" class="pr-choice" :aria-pressed="printerStore.ticketStyle === 'image'" @click="savePrinterSettings({ ticketStyle: 'image' })">
                <strong>Con diseño de restaurante</strong><small>Logo, mesa y total enmarcados, sello de pagado.</small>
              </button>
              <button type="button" class="pr-choice" :aria-pressed="printerStore.ticketStyle === 'text'" @click="savePrinterSettings({ ticketStyle: 'text' })">
                <strong>Texto sencillo</strong><small>Sale más rápido en impresoras lentas.</small>
              </button>
            </div>
            <div class="pr-switch-row">
              <div>
                <h3>Imprimir el ticket al cobrar</h3>
                <p class="hint">Al terminar de cobrar sale la cuenta sola. Si lo apagas, te pregunta cada vez.</p>
              </div>
              <button type="button" role="switch" class="pr-switch" :aria-checked="printerStore.autoPrint" aria-label="Imprimir el ticket al cobrar" @click="savePrinterSettings({ autoPrint: !printerStore.autoPrint })"></button>
            </div>
            <div class="pr-switch-row">
              <div>
                <h3>Abrir el cajón al cobrar en efectivo</h3>
                <p class="hint">Manda el pulso al cajón conectado a la impresora (conector RJ11).</p>
              </div>
              <button type="button" role="switch" class="pr-switch" :aria-checked="printerStore.drawer" aria-label="Abrir el cajón al cobrar en efectivo" @click="savePrinterSettings({ drawer: !printerStore.drawer })"></button>
            </div>
          </section>
        </template>

        <!-- Apariencia -->
        <section v-else-if="section === 'apariencia'" class="panel">
          <p class="hint">Los colores de tu negocio salen de tu logo (en «Datos y logo»). Aquí eliges si la app se ve en claro u oscuro.</p>
          <div class="theme-switch" role="group" aria-label="Tema de interfaz">
            <button type="button" :class="{ on: !isDark }" @click="applyUiTheme('light')"><span class="theme-ico" aria-hidden="true">☀</span> Claro</button>
            <button type="button" :class="{ on: isDark }" @click="applyUiTheme('dark')"><span class="theme-ico" aria-hidden="true">☾</span> Oscuro</button>
          </div>
          <div class="swatch-row" aria-hidden="true">
            <span class="swatch primary" /><span class="swatch accent" /><span class="swatch surface" /><span class="swatch ink" />
          </div>
        </section>

        <!-- Mi cuenta -->
        <section v-else-if="section === 'cuenta'" class="panel">
          <p class="hint">Sesión de <strong>{{ authStore.username }}</strong> · {{ roleText(authStore.role) }}.</p>
          <form class="pass-form" @submit.prevent="changePassword">
            <h3>Cambiar contraseña</h3>
            <label>Contraseña actual<input v-model="pass.current" type="password" autocomplete="current-password" required /></label>
            <label>Contraseña nueva<input v-model="pass.next" type="password" autocomplete="new-password" required minlength="8" /></label>
            <label>Repite la contraseña nueva<input v-model="pass.again" type="password" autocomplete="new-password" required minlength="8" /></label>
            <button type="submit" class="btn-primary" :disabled="changing">{{ changing ? "Guardando…" : "Cambiar contraseña" }}</button>
          </form>
          <p v-if="passMsg" class="ok" role="status">{{ passMsg }}</p>
          <p v-if="passErr" class="err" role="alert">{{ passErr }}</p>
        </section>

        <p v-if="message" class="flash" :class="{ err: messageIsError }" :role="messageIsError ? 'alert' : 'status'">{{ message }}</p>
      </main>
    </div>
  </AppShell>
</template>

<script setup>
import { computed, onMounted, onUnmounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import AppShell from "../components/AppShell.vue";
import FocusPicker from "../components/FocusPicker.vue";
import UberStoreStatus from "../components/UberStoreStatus.vue";
import UberMetrics from "../components/UberMetrics.vue";
import UberMenu from "../components/UberMenu.vue";
import UberConnect from "../components/UberConnect.vue";
import { apiService } from "../apiService";
import { authStore, clearSession } from "../authStore";
import { saveVenueSettings, venueStore } from "../venueStore";
import { DEFAULT_ACCENT, DEFAULT_PRIMARY, applyBrand } from "../brandTheme";
import LogoPicker from "../components/LogoPicker.vue";
import { themeStore, applyUiTheme } from "../themeStore";
import { inviteStatusLabel, labelOf, roleLabel } from "../labels";
import { ROLE_DEFS, focusFor, focusInfo } from "../roles";
import { connectPrinter, openCashDrawer, printTestPage, printerStore, printerSupport, savePrinterSettings } from "../thermalPrinter";

const router = useRouter();
const route = useRoute();

// Íconos del menú (SVG fijos del propio código, mismo trazo que los de la barra inferior)
const svg = (d) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICONS = {
  store: svg('<path d="M4 9l1.5-5h13L20 9"/><path d="M4 9a2.7 2.7 0 005.3 0 2.7 2.7 0 005.4 0A2.7 2.7 0 0020 9"/><path d="M5 12v8h14v-8"/>'),
  tune: svg('<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>'),
  mail: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>'),
  users: svg('<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0112 0M16 5a3 3 0 010 6M21 20a6 6 0 00-4-5.6"/>'),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>'),
  plug: svg('<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/>'),
  printer: svg('<path d="M7 9V4h10v5"/><path d="M7 17H5a1 1 0 01-1-1v-5a2 2 0 012-2h12a2 2 0 012 2v5a1 1 0 01-1 1h-2"/><path d="M7 14h10v6H7z"/>'),
  card: svg('<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18M7 15h3"/>'),
  lock: svg('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>'),
  chat: svg('<path d="M4 5h16v11H9l-5 4V5z"/>'),
  logout: svg('<path d="M10 4H5v16h5M15 8l4 4-4 4M19 12H9"/>'),
};

const NAV = [
  {
    title: "Mi negocio",
    items: [
      { id: "negocio", icon: "store", label: "Datos y logo", desc: "Nombre, dirección, logo y zona horaria", lead: "Así te ven tus clientes y tu equipo." },
      { id: "operacion", icon: "tune", label: "Cómo trabajas", desc: "Solo para llevar, con meseros o completo", lead: "Decide qué roles y pantallas tiene tu equipo." },
      { id: "integraciones", icon: "plug", label: "Uber Eats", desc: "Recibe sus pedidos en Caja", lead: "Conecta tu tienda de Uber Eats." },
      { id: "terminal", icon: "card", label: "Terminal de cobro", desc: "Cobra con tarjeta en tu terminal Mercado Pago", lead: "Conecta tu cuenta y elige tu terminal Point." },
    ],
  },
  {
    title: "Equipo",
    items: [
      { id: "equipo", icon: "mail", label: "Invitaciones", desc: "Invita por correo y asigna el rol", lead: "Invita a tu equipo por correo." },
      { to: "/team", id: "team", icon: "users", label: "Cuentas y roles", desc: "Crea cuentas y cambia el rol de cada persona" },
    ],
  },
  {
    title: "Esta aplicación",
    items: [
      { id: "apariencia", icon: "sun", label: "Apariencia", desc: "Tema claro u oscuro", lead: "Cómo se ve la app en este dispositivo." },
      { id: "impresora", icon: "printer", label: "Impresora", desc: "Térmica USB o Bluetooth de este dispositivo", lead: "Cómo imprime este dispositivo las cuentas, comandas y cortes." },
    ],
  },
  {
    title: "Mi cuenta",
    items: [
      { id: "cuenta", icon: "lock", label: "Contraseña", desc: "Cambia tu contraseña de acceso", lead: "Tus datos de acceso." },
      { to: "/support", id: "support", icon: "chat", label: "Soporte", desc: "Escríbenos y mira las respuestas" },
    ],
  },
];
const SECTIONS = Object.fromEntries(NAV.flatMap((g) => g.items).filter((i) => !i.to).map((i) => [i.id, i]));

// En pantalla ancha se abre la primera sección; en el celular se empieza por el menú
const wide = typeof window !== "undefined" && window.matchMedia?.("(min-width: 768px)").matches;
const section = ref(wide ? "negocio" : "");
const current = computed(() => SECTIONS[section.value] || { label: "", lead: "" });
const open = (id) => {
  section.value = id;
  message.value = "";
};

const isDark = computed(() => themeStore.mode === "dark");
const inviteText = (s) => labelOf(inviteStatusLabel, s);
const roleText = (r) => labelOf(roleLabel, r);

const form = reactive({
  businessName: venueStore.businessName || "",
  businessType: venueStore.businessType || "restaurant",
  // El guardado explícito, o el que deduce su tipo de negocio (los antiguos no lo tienen guardado)
  serviceFocus: venueStore.serviceFocus || focusFor(venueStore),
  address: venueStore.address || "",
  phone: venueStore.phone || "",
  logoUrl: venueStore.logoUrl || "/logo.svg",
  primaryColor: venueStore.primaryColor || DEFAULT_PRIMARY,
  accentColor: venueStore.accentColor || DEFAULT_ACCENT,
  timezone: venueStore.timezone || "America/Mexico_City",
  initialTables: venueStore.initialTables || 8,
});
const hasTables = computed(() => focusInfo(form.serviceFocus).mode !== "counter");

const saving = ref(false);
const message = ref("");
const messageIsError = ref(false);

// Una vista previa que no se guardó no se queda: al salir vuelven los colores guardados
onUnmounted(() => applyBrand(venueStore.primaryColor, venueStore.accentColor));

async function saveBrand() {
  saving.value = true;
  message.value = "";
  messageIsError.value = false;
  try {
    await saveVenueSettings({ ...form });
    message.value = "Configuración guardada.";
  } catch (e) {
    // El servidor puede rechazar el cambio con una razón clara (p. ej. el equipo no cabe en el nuevo enfoque)
    message.value = e?.message || "No se pudo guardar.";
    messageIsError.value = true;
  } finally {
    saving.value = false;
  }
}

// ——— Invitaciones ———
const invites = ref([]);
const inviting = ref(false);
const inviteMsg = ref("");
const inviteErr = ref("");
// Solo los roles que existen en el enfoque guardado del negocio
const inviteRoles = computed(() => ROLE_DEFS.filter((r) => focusInfo(focusFor(venueStore)).roles.includes(r.id)));
const invite = reactive({ email: "", role: inviteRoles.value.find((r) => r.id === "waiter")?.id || inviteRoles.value[0]?.id || "cashier" });

async function loadInvites() {
  try {
    invites.value = (await apiService.getInvites()) || [];
  } catch {
    invites.value = [];
  }
}

async function sendInvite() {
  inviting.value = true;
  inviteMsg.value = "";
  inviteErr.value = "";
  try {
    const res = await apiService.createInvite({ email: invite.email, role: invite.role });
    inviteMsg.value = res.mail?.fallback
      ? "Invitación creada. Revisa la consola del backend (SMTP no configurado)."
      : "Invitación enviada por correo.";
    invite.email = "";
    await loadInvites();
  } catch (e) {
    inviteErr.value = e.response?.data || "No se pudo enviar la invitación.";
  } finally {
    inviting.value = false;
  }
}

async function revoke(i) {
  await apiService.revokeInvite(i.id);
  await loadInvites();
}

async function removeInvite(i) {
  if (!confirm("¿Eliminar invitación?")) return;
  await apiService.deleteInvite(i.id);
  await loadInvites();
}

// ——— Uber Eats ———
const uber = reactive({
  loaded: false, configured: false, oauth: false, environment: "sandbox", storeId: "", storeInput: "", storeName: "", storeAddress: "",
  linkedVia: "", integrationEnabled: null, deprovisioned: false, busy: false, error: "",
});
const uberChoose = ref(false); // al volver de Uber con varias tiendas: toca elegir
const UBER_RETURN = {
  cancelled: "Cancelaste la conexión con Uber Eats.",
  state: "El enlace de conexión caducó. Vuelve a intentarlo.",
  taken: "Esa tienda ya está conectada a otro negocio.",
};

async function loadUber() {
  try {
    const s = await apiService.uberStatus();
    Object.assign(uber, {
      loaded: true, configured: s.configured, environment: s.environment, storeId: s.storeId || "", storeInput: s.storeId || "",
      oauth: !!s.oauth, storeName: s.storeName || "", storeAddress: s.storeAddress || "", linkedVia: s.linkedVia || "",
      integrationEnabled: s.integrationEnabled ?? null, deprovisioned: !!s.deprovisioned,
    });
  } catch {
    uber.loaded = false;
  }
}

async function linkUber() {
  uber.busy = true;
  uber.error = "";
  try {
    const s = await apiService.uberLink(uber.storeInput);
    uber.storeId = s.storeId;
    message.value = "Tienda de Uber Eats vinculada.";
    messageIsError.value = false;
  } catch (e) {
    uber.error = e.response?.data || "No se pudo vincular la tienda.";
  } finally {
    uber.busy = false;
  }
}

async function unlinkUber() {
  if (!confirm("¿Dejar de recibir los pedidos de esta tienda de Uber Eats?")) return;
  uber.busy = true;
  uber.error = "";
  try {
    const r = await apiService.uberUnlink();
    uber.storeId = "";
    uber.storeInput = "";
    await loadUber();
    // Una tienda que activamos por OAuth sigue mandando pedidos que nadie atendería si Uber no la apagó
    if (r.deactivated === false) {
      uber.error = "Se desvinculó aquí, pero no pudimos apagarla en Uber Eats. Quita el acceso de MiRestaurante desde Uber Eats Manager o pídelo a tu gerente de Uber; si no, seguirán llegando pedidos que nadie atenderá.";
    }
  } catch (e) {
    uber.error = e.response?.data || "No se pudo desvincular.";
  } finally {
    uber.busy = false;
  }
}

// ——— Impresora de este dispositivo ———
const PRINTER_MODES = [
  { id: "browser", label: "Navegador (actual)", hint: "Abre el ticket y el diálogo de imprimir del navegador. Sirve con cualquier impresora." },
  { id: "usb", label: "Térmica USB", hint: "Sale directo, sin diálogo. En Windows solo abre si la impresora no tiene su propio driver; si no abre, usa «puerto COM». Chrome en PC o Android (con cable OTG)." },
  { id: "serial", label: "Térmica USB (puerto COM)", hint: "Para impresoras que Windows muestra como puerto COM: es lo que mejor funciona en Windows. Chrome o Edge en PC." },
  { id: "bluetooth", label: "Térmica Bluetooth", hint: "Sale directo, sin diálogo. Chrome en Android o en computadora con Bluetooth." },
];
const printerErr = ref("");
const printerLine = computed(() => {
  const name = printerStore.deviceName;
  if (printerStore.connected) return `Conectada: ${name}`;
  if (printerStore.lost) return "Sin conexión con la impresora. Se reintenta sola.";
  if (!name) return "Sin impresora elegida";
  if (printerStore.trying) return `Elegida: ${name} (conectando…)`;
  if (printerStore.error) return `Elegida: ${name}. No se pudo conectar: ${printerStore.error}`;
  return `Elegida: ${name} (se conecta al imprimir)`;
});
function setPrinterMode(mode) {
  printerErr.value = "";
  savePrinterSettings({ mode, deviceName: mode === printerStore.mode ? printerStore.deviceName : "" });
}
async function printerJob(job, ok) {
  printerErr.value = "";
  try {
    await job();
    message.value = ok;
    messageIsError.value = false;
  } catch (e) {
    printerErr.value = e?.message || "La impresora no respondió.";
  }
}
const choosePrinter = () => printerJob(() => connectPrinter({ prompt: true }), "Impresora lista.");
const testPrint = () => printerJob(() => printTestPage(), "Prueba enviada a la impresora.");
const pulseDrawer = () => printerJob(() => openCashDrawer(), "Se mandó el pulso al cajón.");

// ——— Terminal de cobro (Mercado Pago Point) ———
// terminals = las registradas con su nombre interno; account = las que Mercado Pago tiene en la cuenta
const pt = reactive({ loaded: false, available: false, connected: false, ok: false, terminalLabel: "", message: "", terminals: [], account: [], names: {}, pick: "", newName: "", busy: false, error: "" });
const freeTerminals = computed(() => pt.account.filter((a) => !pt.terminals.some((t) => t.id === a.id)));
const MP_RETURN = {
  cancelled: "Cancelaste la conexión con Mercado Pago.",
  state: "El enlace de conexión caducó. Vuelve a intentarlo.",
};

async function loadPoint() {
  try {
    Object.assign(pt, await apiService.pointStatus(), { loaded: true });
    pt.names = Object.fromEntries(pt.terminals.map((t) => [t.id, t.name]));
    pt.account = pt.connected ? await apiService.pointTerminals().catch(() => []) : [];
  } catch {
    pt.loaded = false;
  }
}

async function connectPoint() {
  pt.busy = true;
  pt.error = "";
  try {
    window.location.href = (await apiService.pointConnect()).url;
  } catch (e) {
    pt.error = e.response?.data?.message || "No se pudo iniciar la conexión.";
    pt.busy = false;
  }
}

async function pickTerminal() {
  pt.busy = true;
  pt.error = "";
  try {
    await apiService.pointRegisterTerminal(pt.pick, pt.newName);
    pt.pick = "";
    pt.newName = "";
    await loadPoint();
    message.value = "Terminal lista para cobrar.";
    messageIsError.value = false;
  } catch (e) {
    pt.error = e.response?.data?.message || "No se pudo usar esa terminal.";
  } finally {
    pt.busy = false;
  }
}

async function renameTerminal(t) {
  pt.busy = true;
  pt.error = "";
  try {
    await apiService.pointRenameTerminal(t.id, pt.names[t.id]);
    await loadPoint();
  } catch (e) {
    pt.error = e.response?.data?.message || "No se pudo cambiar el nombre.";
  } finally {
    pt.busy = false;
  }
}

async function removeTerminal(t) {
  if (!confirm(`¿Quitar la terminal «${t.name}»? Dejará de recibir cobros desde la plataforma.`)) return;
  pt.busy = true;
  pt.error = "";
  try {
    await apiService.pointRemoveTerminal(t.id);
    await loadPoint();
  } catch (e) {
    pt.error = e.response?.data?.message || "No se pudo quitar la terminal.";
  } finally {
    pt.busy = false;
  }
}

async function disconnectPoint() {
  if (!confirm("¿Desconectar tu cuenta de Mercado Pago? Las tarjetas se registrarán a mano.")) return;
  pt.busy = true;
  pt.error = "";
  try {
    await apiService.pointDisconnect();
    pt.pick = "";
    await loadPoint();
  } catch (e) {
    pt.error = e.response?.data?.message || "No se pudo desconectar.";
  } finally {
    pt.busy = false;
  }
}

// ——— Mi cuenta ———
const pass = reactive({ current: "", next: "", again: "" });
const changing = ref(false);
const passMsg = ref("");
const passErr = ref("");

async function changePassword() {
  passMsg.value = "";
  passErr.value = "";
  if (pass.next !== pass.again) {
    passErr.value = "Las contraseñas nuevas no coinciden.";
    return;
  }
  changing.value = true;
  try {
    await apiService.changePassword({ currentPassword: pass.current, newPassword: pass.next });
    Object.assign(pass, { current: "", next: "", again: "" });
    passMsg.value = "Contraseña cambiada. Úsala la próxima vez que entres.";
  } catch (e) {
    passErr.value = (typeof e.response?.data === "string" && e.response.data) || "No se pudo cambiar la contraseña.";
  } finally {
    changing.value = false;
  }
}

function logout() {
  clearSession();
  router.push("/login");
}

onMounted(async () => {
  loadInvites();
  loadUber();
  if (route.query.s === "impresora") {
    open("impresora");
    router.replace({ query: {} });
  }
  await loadPoint();
  // Al volver de Mercado Pago se abre esta sección y se dice cómo salió
  if (route.query.s === "terminal") {
    open("terminal");
    if (route.query.mp === "ok") {
      message.value = "Cuenta de Mercado Pago conectada. Ahora elige tu terminal.";
      messageIsError.value = false;
    } else if (route.query.mp === "error") {
      pt.error = MP_RETURN[route.query.reason] || "No se pudo conectar tu cuenta de Mercado Pago.";
    }
    router.replace({ query: {} });
  } else if (route.query.s === "integraciones") {
    open("integraciones");
    const r = route.query.uber;
    if (r === "activated") {
      message.value = "Tienda de Uber Eats conectada.";
      messageIsError.value = false;
    } else if (r === "removed") {
      message.value = "La tienda se quitó de Uber Eats por completo.";
      messageIsError.value = false;
    } else if (r === "choose") uberChoose.value = true;
    else if (r === "none") uber.error = "Tu cuenta de Uber no tiene tiendas de Uber Eats.";
    else if (r === "taken") uber.error = UBER_RETURN.taken;
    else if (r === "error") uber.error = UBER_RETURN[route.query.reason] || "No se pudo conectar tu tienda con Uber Eats.";
    router.replace({ query: {} });
  }
});
</script>

<style scoped>
.settings { animation: t-fade-up .45s ease both; }
.cfg-layout { display: grid; gap: 1rem; align-items: start; }
.cfg-nav { display: grid; gap: 1rem; }
.cfg-nav-head h1 { margin: 0; font-family: var(--font-display); font-size: 1.5rem; letter-spacing: -0.01em; }
.cfg-nav-head p { margin: 0.1rem 0 0; font-size: 0.88rem; font-weight: 600; color: var(--mirestaurante-muted); }
.cfg-group { background: var(--mirestaurante-panel); border: 1px solid var(--mirestaurante-line); border-radius: 1rem; overflow: hidden; }
.cfg-group h2 { margin: 0; padding: 0.7rem 1rem 0.35rem; font-size: 0.72rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--mirestaurante-muted); }
.cfg-item {
  all: unset; box-sizing: border-box; width: 100%; display: flex; align-items: center; gap: 0.8rem;
  padding: 0.75rem 1rem; cursor: pointer; color: var(--mirestaurante-ink);
}
.cfg-item + .cfg-item { border-top: 1px solid var(--mirestaurante-line); }
.cfg-item:hover { background: var(--mirestaurante-panel-elevated); }
.cfg-item:focus-visible { outline: 2px solid var(--mirestaurante-primary); outline-offset: -2px; }
.cfg-item.on { background: color-mix(in srgb, var(--mirestaurante-primary) 9%, var(--mirestaurante-panel)); }
.cfg-item.on .cfg-txt strong { color: var(--mirestaurante-primary); }
.cfg-ico { display: grid; place-items: center; width: 2.4rem; height: 2.4rem; border-radius: 0.7rem; flex: none; background: var(--mirestaurante-primary-soft); color: var(--mirestaurante-primary); }
.cfg-txt { display: grid; gap: 0.1rem; min-width: 0; flex: 1; }
.cfg-txt strong { font-size: 0.95rem; }
.cfg-txt small { font-size: 0.8rem; color: var(--mirestaurante-muted); line-height: 1.3; }
.cfg-chev { font-size: 1.3rem; color: var(--mirestaurante-muted); }
.cfg-item.logout { background: var(--mirestaurante-panel); border: 1px solid var(--mirestaurante-line); border-radius: 1rem; }
.cfg-item.logout strong { color: var(--mirestaurante-danger); }
.cfg-item.logout .cfg-ico { background: color-mix(in srgb, var(--mirestaurante-danger) 12%, transparent); color: var(--mirestaurante-danger); }

.cfg-main { display: grid; gap: 0.75rem; min-width: 0; }
.cfg-sec-head { display: flex; align-items: center; gap: 0.75rem; }
.cfg-sec-head h2 { margin: 0; font-family: var(--font-display); font-size: 1.35rem; letter-spacing: -0.01em; }
.cfg-sec-head p { margin: 0.1rem 0 0; font-size: 0.88rem; color: var(--mirestaurante-muted); }
.cfg-back { width: 2.6rem; height: 2.6rem; border-radius: 0.8rem; border: 1px solid var(--mirestaurante-line); background: var(--mirestaurante-panel-elevated); color: var(--mirestaurante-ink); font-size: 1.5rem; cursor: pointer; line-height: 1; }

.panel { background: var(--mirestaurante-panel); border: 1px solid var(--mirestaurante-line); border-radius: 1.15rem; padding: 1.3rem; box-shadow: var(--mirestaurante-shadow); display: grid; gap: 0.9rem; }
.panel h3 { margin: 0.4rem 0 0; font-size: 0.95rem; }
.hint { color: var(--mirestaurante-muted); font-size: 0.9rem; margin: 0; line-height: 1.45; }
.flash { margin: 0; padding: 0.7rem 0.9rem; border-radius: 0.8rem; background: color-mix(in srgb, var(--mirestaurante-success) 14%, transparent); color: var(--mirestaurante-success); font-size: 0.9rem; font-weight: 600; }
.flash.err { background: color-mix(in srgb, var(--mirestaurante-danger) 12%, transparent); color: var(--mirestaurante-danger); }
.theme-switch { display: flex; gap: 0.5rem; background: var(--mirestaurante-surface); padding: 0.35rem; border-radius: 0.9rem; border: 1px solid var(--mirestaurante-line); max-width: 22rem; }
.theme-switch button { flex: 1; min-height: 3rem; border: none; border-radius: 0.7rem; background: transparent; color: var(--mirestaurante-ink); font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 0.4rem; }
.theme-switch button.on { background: var(--mirestaurante-primary); color: var(--mirestaurante-on-primary); }
.theme-ico { font-size: 1.05rem; line-height: 1; }
.swatch-row { display: flex; gap: 0.45rem; }
.swatch { width: 1.65rem; height: 1.65rem; border-radius: 0.45rem; border: 1px solid var(--mirestaurante-line); }
.swatch.primary { background: var(--mirestaurante-primary); }
.swatch.accent { background: var(--mirestaurante-accent); }
.swatch.surface { background: var(--mirestaurante-surface); }
.swatch.ink { background: var(--mirestaurante-ink); }
.form-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr)); gap: 0.8rem; }
label { display: grid; gap: 0.3rem; font-size: 0.85rem; font-weight: 500; }
.inline-field { max-width: 14rem; }
input, select { border: 1px solid var(--mirestaurante-line); border-radius: 0.65rem; padding: 0.65rem 0.75rem; font: inherit; background: var(--mirestaurante-panel-elevated); color: var(--mirestaurante-ink); }
.link-btn { margin-left: 0.6rem; background: none; border: none; padding: 0; color: var(--mirestaurante-danger); font: inherit; font-weight: 600; cursor: pointer; text-decoration: underline; }
.btn-primary { justify-self: start; background: var(--mirestaurante-primary); color: var(--mirestaurante-on-primary); border: none; border-radius: 0.7rem; padding: 0.65rem 1.05rem; font-weight: 600; cursor: pointer; box-shadow: var(--mirestaurante-shadow); }
.btn-primary:disabled { opacity: 0.6; cursor: default; }
.ok { color: var(--mirestaurante-success); font-size: 0.88rem; margin: 0; }
.err { color: var(--mirestaurante-danger); font-size: 0.88rem; margin: 0; }
.pass-form { display: grid; gap: 0.7rem; max-width: 24rem; }
.pr-card { display: grid; gap: 0.85rem; }
.pr-card h3 { margin: 0; font-size: 1.02rem; font-weight: 800; }
.pr-choices { display: grid; grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr)); gap: 0.6rem; }
.pr-choice { display: grid; gap: 0.2rem; align-content: start; text-align: left; padding: 0.75rem 0.85rem; border-radius: 0.9rem; border: 1.5px solid var(--mirestaurante-line); background: var(--mirestaurante-surface); color: var(--mirestaurante-ink); font: inherit; cursor: pointer; }
.pr-choice small { color: var(--mirestaurante-muted); font-size: 0.8rem; line-height: 1.3; }
.pr-choice[aria-pressed="true"] { border-color: var(--mirestaurante-primary); background: var(--mirestaurante-primary-soft); }
.pr-choice:disabled { opacity: 0.55; cursor: default; }
.pr-state { display: flex; align-items: center; gap: 0.5rem; margin: 0; font-size: 0.88rem; font-weight: 700; color: var(--mirestaurante-muted); }
.pr-state i { width: 0.6rem; height: 0.6rem; border-radius: 50%; background: var(--mirestaurante-muted); flex: none; }
.pr-state.on { color: var(--mirestaurante-success); }
.pr-state.on i { background: var(--mirestaurante-success); }
.pr-state.lost i { background: var(--mirestaurante-warning); }
.pr-acts { display: flex; flex-wrap: wrap; gap: 0.6rem; }
.pr-btn { min-height: 2.5rem; padding: 0 1rem; border-radius: 0.7rem; border: 1.5px solid var(--mirestaurante-line); background: var(--mirestaurante-surface); color: var(--mirestaurante-ink); font: inherit; font-weight: 700; cursor: pointer; }
.pr-btn:disabled { opacity: 0.55; cursor: default; }
.pr-switch-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; }
.pr-switch-row h3 { margin-bottom: 0.2rem; }
.pr-switch { position: relative; flex: none; width: 3rem; height: 1.75rem; border-radius: 999px; border: none; background: var(--mirestaurante-line); cursor: pointer; transition: background 0.15s; }
.pr-switch::after { content: ""; position: absolute; top: 0.2rem; left: 0.2rem; width: 1.35rem; height: 1.35rem; border-radius: 50%; background: #fff; transition: transform 0.15s; }
.pr-switch[aria-checked="true"] { background: var(--mirestaurante-primary); }
.pr-switch[aria-checked="true"]::after { transform: translateX(1.25rem); }
.term-list { list-style: none; margin: 0 0 1rem; padding: 0; display: grid; gap: 0.8rem; }
.term-row { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 0.6rem; }
.term-row label { display: grid; gap: 0.25rem; flex: 1 1 12rem; }
.invite-form { display: grid; grid-template-columns: 1.4fr .8fr auto; gap: .65rem; align-items: end; }
.invite-list { list-style: none; margin: 0; padding: 0; }
.invite-list li { display: flex; justify-content: space-between; gap: 1rem; padding: .75rem 0; border-bottom: 1px solid var(--mirestaurante-line); }
.meta { display: block; font-size: .8rem; color: var(--mirestaurante-muted); }
.row-actions { display: flex; gap: .35rem; }
.row-actions button { border: 1px solid var(--mirestaurante-line); background: var(--mirestaurante-panel-elevated); color: var(--mirestaurante-ink); border-radius: .55rem; padding: .4rem .6rem; cursor: pointer; font-size: .78rem; font-weight: 600; }
.danger { color: var(--mirestaurante-danger); }
.link { justify-self: start; color: var(--mirestaurante-primary); font-weight: 600; }
.empty { color: var(--mirestaurante-muted); }

/* Celular: o el menú o la sección, con botón para volver */
@media (max-width: 767.98px) {
  .cfg-layout.section-open .cfg-nav { display: none; }
  .invite-form { grid-template-columns: 1fr; }
}
/* Pantalla ancha: menú a la izquierda y la sección a la derecha */
@media (min-width: 768px) {
  .cfg-layout { grid-template-columns: 19rem minmax(0, 1fr); gap: 1.4rem; }
  .cfg-nav { position: sticky; top: 0; }
  .cfg-chev, .cfg-back { display: none; }
}
</style>
