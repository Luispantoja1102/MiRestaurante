import { reactive } from "vue";
import {
  normalizeRole,
  roleHome,
  routeRoles,
  homeForRole as homeFor,
  canAccessScreen,
  currentMode,
  OUTSIDE_TENANT_ROLE_IDS,
} from "./roles";

const STORAGE_KEY = "mirestaurante_auth";

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { token: null, role: null, tenantId: null, username: null };
    const saved = JSON.parse(raw);
    return { ...saved, role: normalizeRole(saved.role) };
  } catch {
    return { token: null, role: null, tenantId: null, username: null };
  }
}

export const authStore = reactive({
  ...load(),
});

function persist() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      token: authStore.token,
      role: authStore.role,
      tenantId: authStore.tenantId,
      username: authStore.username,
    })
  );
}

export function setSession({ token, role, tenantId, username }) {
  authStore.token = token || null;
  authStore.role = normalizeRole(role) || null;
  authStore.tenantId = tenantId || null;
  authStore.username = username || null;
  persist();
}

export function clearSession() {
  authStore.token = null;
  authStore.role = null;
  authStore.tenantId = null;
  authStore.username = null;
  localStorage.removeItem(STORAGE_KEY);
}

export function isAuthenticated() {
  return Boolean(authStore.token);
}

export function hasRole(...roles) {
  if (!roles.length) return true;
  return roles.includes(authStore.role);
}

export function isPlatformAdmin() {
  return authStore.role === "platform_admin";
}

/** Admin o soporte de la plataforma. */
export function isPlatformStaff() {
  return authStore.role === "platform_admin" || authStore.role === "platform_support";
}

/** Plataforma o socios: no pertenecen a ningún negocio, así que no hay ajustes de negocio que cargar. */
export function isOutsideTenant() {
  return OUTSIDE_TENANT_ROLE_IDS.includes(authStore.role);
}

// La tabla de roles y pantallas vive en ./roles.js
export { roleHome, routeRoles };

/** ¿Puede la sesión actual entrar a esta pantalla en el modo del negocio (salón o mostrador)? */
export function canAccessRoute(name) {
  return canAccessScreen(name, authStore.role, currentMode());
}

export function homeForRole(role = authStore.role) {
  return homeFor(role, currentMode());
}
