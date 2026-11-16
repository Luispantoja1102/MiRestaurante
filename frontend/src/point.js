// Cobro con la terminal de Mercado Pago, compartido por Caja y el mostrador.
import { reactive, ref } from "vue";
import { apiService } from "./apiService";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const apiMessage = (e) => e.response?.data?.message || "";

export function usePointTerminal() {
  // ok = hay terminal lista para cobrar; connected = ya conectó su cuenta (aunque la terminal falle hoy)
  const term = reactive({ loaded: false, ok: false, connected: false, code: "", message: "", terminalLabel: "" });
  const waiting = ref(false);
  let cancelling = false;
  let chargeId = null;

  async function load() {
    try {
      Object.assign(term, { ok: false, connected: false, code: "", message: "" }, await apiService.pointStatus(), { loaded: true });
    } catch {
      Object.assign(term, { loaded: true, ok: false, connected: false });
    }
  }

  /** Manda el cobro a la terminal y espera. Devuelve el id del cobro aprobado o lanza un Error con el motivo. */
  async function charge(saleId, amount) {
    waiting.value = true;
    cancelling = false;
    try {
      const c = await apiService.pointStartCharge(String(saleId), amount);
      chargeId = c.id;
      let status = c.status;
      while (status === "pending") {
        await sleep(2000);
        const r = await (cancelling ? apiService.pointCancelCharge(chargeId) : apiService.pointCharge(chargeId));
        status = r.status;
        if (cancelling && status === "pending") throw new Error("La terminal ya muestra el cobro: cancélalo en la terminal.");
      }
      if (status === "paid") return chargeId;
      if (status === "review") throw new Error("Mercado Pago pide confirmar este cobro en la terminal. Revísalo con Mercado Pago antes de volver a cobrar.");
      throw new Error(cancelling ? "Cobro cancelado." : "La terminal no aprobó el cobro.");
    } catch (e) {
      throw e.response ? new Error(apiMessage(e) || "No se pudo cobrar en la terminal.") : e;
    } finally {
      waiting.value = false;
    }
  }

  const cancel = () => {
    cancelling = true;
  };

  return { term, waiting, load, charge, cancel };
}
