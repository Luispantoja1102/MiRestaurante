import { onMounted, onUnmounted, ref } from "vue";
import { useRouter } from "vue-router";
import { printerStore, savePrinterSettings } from "./thermalPrinter";

/**
 * Barra de herramientas de los tickets: tamaño de papel, imprimir y cerrar.
 * El ancho del papel es el mismo de Ajustes → Impresora (un solo valor por dispositivo).
 * "Cerrar" siempre hace algo: cierra la pestaña si el navegador lo permite (solo la abrió un script)
 * y si no, regresa a la pantalla anterior.
 */
export function useTicketShell(fallbackPath = "/orders") {
  const router = useRouter();
  const paper = ref(printerStore.paper === "58" ? "58" : "80");

  function applyPage() {
    let el = document.getElementById("tk-page-size");
    if (!el) {
      el = document.createElement("style");
      el.id = "tk-page-size";
      document.head.appendChild(el);
    }
    el.textContent = `@page { size: ${paper.value}mm auto; margin: 0; }`;
  }

  function setPaper(value) {
    paper.value = value === "58" ? "58" : "80";
    savePrinterSettings({ paper: paper.value });
    applyPage();
  }

  const print = () => window.print();

  function close() {
    try {
      window.close();
    } catch {
      /* ignore */
    }
    // Si sigue abierta, el navegador no dejó cerrarla (pestaña normal o app instalada):
    // regresa a la pantalla de la que vino o, si no hay, a la de respaldo.
    setTimeout(() => {
      if (window.closed) return;
      if (window.history.state?.back) router.back();
      else router.replace(typeof fallbackPath === "function" ? fallbackPath() : fallbackPath);
    }, 150);
  }

  function onKey(e) {
    if (e.key === "Escape") close();
  }

  onMounted(() => {
    document.documentElement.classList.add("tk-printing-view");
    applyPage();
    window.addEventListener("keydown", onKey);
  });
  onUnmounted(() => {
    document.documentElement.classList.remove("tk-printing-view");
    window.removeEventListener("keydown", onKey);
    document.getElementById("tk-page-size")?.remove();
  });

  return { paper, setPaper, print, close };
}

export const folioOf = (id) => String(id || "").slice(-6).toUpperCase();

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const DAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
export const monthShort = (m) => MONTHS[m - 1];
export const dayLong = (d) => DAYS[d];
