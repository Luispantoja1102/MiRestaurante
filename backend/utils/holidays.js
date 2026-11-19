// Horarios especiales de la tienda en Uber Eats (festivos, cierres, horario corto un día).
// Uber guarda excepciones por fecha: `holiday_hours: { "2026-12-25": { open_time_periods: [{ start_time, end_time }] } }`.
// - un día cerrado todo el día se manda con start_time y end_time en "00:00";
// - cada POST REEMPLAZA todos los horarios especiales de la tienda: siempre se manda la lista completa.

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_DAYS = 60; // tope propio: Uber no documenta un límite
const MAX_PERIODS = 3; // periodos abiertos por día

/** Día de hoy (AAAA-MM-DD) en la zona horaria del negocio. */
function todayIn(timezone) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone || 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

const pad = (t) => String(t || '').replace(/^(\d):/, '0$1:'); // Uber a veces manda "9:00"
const validDate = (s) => {
  if (!DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; // descarta 2026-02-31
};

/** Lo que responde Uber → lista para la pantalla: [{ date, closed, periods: [{ start, end }] }], por fecha. */
function fromUber(map = {}) {
  return Object.entries(map || {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => {
      const periods = (v?.open_time_periods || []).map((p) => ({ start: pad(p.start_time), end: pad(p.end_time) }));
      const closed = !periods.length || periods.every((p) => p.start === '00:00' && p.end === '00:00');
      return { date, closed, periods: closed ? [] : periods };
    });
}

/**
 * Lo que manda la pantalla → cuerpo para Uber. `days`: [{ date, closed?, periods?: [{ start, end }] }].
 * @returns { value: { "AAAA-MM-DD": { open_time_periods } } } o { error }
 */
function toUber(days, today) {
  if (!Array.isArray(days)) return { error: 'Manda la lista de días' };
  if (days.length > MAX_DAYS) return { error: `Máximo ${MAX_DAYS} días con horario especial` };
  const value = {};
  for (const d of days) {
    const date = String(d?.date || '');
    if (!validDate(date)) return { error: `La fecha «${date}» no es válida` };
    if (date < today) return { error: `La fecha ${date} ya pasó` };
    if (value[date]) return { error: `El ${date} está repetido` };
    if (d.closed) {
      value[date] = { open_time_periods: [{ start_time: '00:00', end_time: '00:00' }] };
      continue;
    }
    const periods = Array.isArray(d.periods) ? d.periods : [];
    if (!periods.length || periods.length > MAX_PERIODS) return { error: `El ${date} necesita de 1 a ${MAX_PERIODS} horarios abiertos` };
    for (const p of periods) {
      if (!HHMM.test(p?.start) || !HHMM.test(p?.end)) return { error: `Los horarios del ${date} deben ser de la forma 09:00` };
      if (p.end <= p.start) return { error: `El ${date}: la hora de cierre debe ser después de la de apertura` };
    }
    // sin traslapes (ordenados por apertura)
    const sorted = [...periods].sort((a, b) => a.start.localeCompare(b.start));
    for (let i = 1; i < sorted.length; i++) if (sorted[i].start < sorted[i - 1].end) return { error: `El ${date} tiene horarios que se traslapan` };
    value[date] = { open_time_periods: sorted.map((p) => ({ start_time: p.start, end_time: p.end })) };
  }
  return { value };
}

module.exports = { todayIn, fromUber, toUber, MAX_DAYS, MAX_PERIODS };
