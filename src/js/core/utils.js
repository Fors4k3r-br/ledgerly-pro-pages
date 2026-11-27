// Utilitários puros compartilhados: formatação, datas, escape HTML, conversão binária e plugin de gráfico.

import { isPrivacyMode } from './state.js';

export const PROV_TIPOS = { DIV: 'Dividendos', JCP: 'JCP', REND: 'Rendimentos', AMORT: 'Amortização', OUTRO: 'Outros' };

export function escapeSavedNoteText(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

export const hexOf = buf => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
export const bytesOf = hex => new Uint8Array(hex.match(/.{2}/g).map(b => parseInt(b, 16)));

export function toISODate(s) {
  s = String(s || '');
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}

export const isoToBR = s => { const [y, m, d] = String(s).split('-'); return `${d}/${m}/${y}`; };

export function todayISO(offsetDays = 0) {
  const d = new Date(); d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function formatMoney(value) {
  if (isPrivacyMode) return 'R$ •••••';
  const num = Number(value) || 0;
  return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function formatPercent(value) {
  if (isPrivacyMode) return '•••%';
  const num = Number(value) || 0;
  return `${num.toFixed(2).replace('.', ',')}%`;
}

export function formatNumber(value) {
  const num = Number(value) || 0;
  return num.toLocaleString('pt-BR', { maximumFractionDigits: 4 });
}

export function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

const chartTooltipHideMs = 4000; // balões dos gráficos somem sozinhos depois deste tempo
// No toque, o balão do Chart.js ficaria aberto até tocar em outro lugar: este plugin o esconde depois de alguns segundos
export function autoHideTooltipPlugin() {
  return {
    id: 'autoHideTooltip',
    afterEvent(chart, args) {
      const e = args.event; if (!e || e.type === 'mouseout') return;
      clearTimeout(chart.$hideTimer);
      chart.$hideTimer = setTimeout(() => {
        try {
          chart.tooltip.setActiveElements([], { x: 0, y: 0 });
          chart.setActiveElements([]);
          chart.update('none');
        } catch (_) {}
      }, chartTooltipHideMs);
    },
    beforeDestroy(chart) { clearTimeout(chart.$hideTimer); }
  };
}
