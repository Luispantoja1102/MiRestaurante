<template>
  <div>
    <div class="trend" role="img" :aria-label="summary">
      <div v-for="m in trend" :key="m.month" class="col">
        <div class="bars">
          <i class="rev" :style="{ height: pct(m.revenue) }" :title="`Cobrado ${money(m.revenue)}`"></i>
          <i class="exp" :style="{ height: pct(m.expenses) }" :title="`Gastos ${money(m.expenses)}`"></i>
        </div>
        <span class="lbl">{{ m.label }}</span>
        <span class="val" :class="{ neg: m.profit < 0 }">{{ money(m.profit) }}</span>
      </div>
    </div>
    <p class="legend"><i class="rev"></i> Cobrado <i class="exp"></i> Gastos · debajo, cobrado menos gastos (antes de comisiones)</p>
  </div>
</template>

<script setup>
import { computed } from "vue";
import { money } from "./format";

const props = defineProps({ trend: { type: Array, required: true } });

const max = computed(() => Math.max(1, ...props.trend.flatMap((m) => [m.revenue, m.expenses])));
const pct = (value) => `${Math.max(value > 0 ? 4 : 0, Math.round((value / max.value) * 100))}%`;
const summary = computed(() =>
  props.trend.map((m) => `${m.label}: cobrado ${money(m.revenue)}, gastos ${money(m.expenses)}`).join('. ')
);
</script>

<style scoped>
.trend { display: grid; grid-template-columns: repeat(6, 1fr); gap: 0.5rem; align-items: end; }
.col { display: grid; gap: 0.3rem; text-align: center; }
.bars { height: 7rem; display: flex; gap: 0.25rem; align-items: flex-end; justify-content: center; }
.bars i { width: 38%; max-width: 1.6rem; border-radius: 0.3rem 0.3rem 0 0; min-height: 0; }
i.rev { background: #6ee7b7; }
i.exp { background: #b8956c; }
.lbl { font-size: 0.78rem; text-transform: uppercase; color: #9aa8a1; }
.val { font-size: 0.78rem; color: #f2f4f3; }
.val.neg { color: #f87171; }
.legend { margin: 0.75rem 0 0; font-size: 0.78rem; color: #9aa8a1; }
.legend i { display: inline-block; width: 0.7rem; height: 0.7rem; border-radius: 0.2rem; margin: 0 0.25rem 0 0.6rem; vertical-align: middle; }
.legend i:first-child { margin-left: 0; }
</style>
