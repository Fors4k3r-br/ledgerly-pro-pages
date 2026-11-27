// Cadastro, listagem, gráfico mensal e totalização de proventos recebidos.

import { db, isPrivacyMode } from '../core/state.js';
import { getSetting, persistSQLiteToIndexedDB, queryAll } from '../core/database.js';
import { escapeSavedNoteText } from '../notes/notes-manager.js';
import { allPositionsData, autoHideTooltipPlugin, getConsolidatedPositions, refreshAllViews } from '../portfolio/positions.js';
import { formatMoney, formatNumber, formatPercent, openConfirmDialog, showToast, themeRgb } from '../ui/navigation.js';

// =========================================================================
// PROVENTOS (dividendos, JCP, rendimentos) vinculados ao ticker de cada ativo
// =========================================================================
export const PROV_TIPOS = { DIV: 'Dividendos', JCP: 'JCP', REND: 'Rendimentos', AMORT: 'Amortização', OUTRO: 'Outros' };
function parseMoneyField(v) {
  const s = String(v || '').trim().replace(/\s/g, '');
  if (!s) return 0;
  const n = s.includes(',') ? parseFloat(s.replace(/\./g, '').replace(',', '.')) : parseFloat(s);
  return isFinite(n) ? n : NaN;
}
export const isoToBR = s => { const [y, m, d] = String(s).split('-'); return `${d}/${m}/${y}`; };
export function todayISO(offsetDays = 0) {
  const d = new Date(); d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function provAutoTax() {
  const imp = document.getElementById('provImposto');
  if (!imp || imp.dataset.manual === '1') return;
  const bruto = parseMoneyField(document.getElementById('provBruto').value);
  const jcp = document.getElementById('provTipo').value === 'JCP';
  imp.value = jcp && bruto > 0 ? (bruto * 0.15).toFixed(2).replace('.', ',') : '';
}
function onProvTickerChange() {
  const t = document.getElementById('provTicker').value;
  // Sugere a corretora onde o ativo tem a maior custódia atual
  const rows = queryAll(`SELECT corretora_id, SUM(CASE WHEN tipo_ordem = 'C' THEN quantidade ELSE -quantidade END) AS q FROM operacoes WHERE ticker = ? GROUP BY corretora_id ORDER BY q DESC`, [t]);
  const sel = document.getElementById('provCorretora');
  sel.value = (rows.length && rows[0].corretora_id != null) ? String(rows[0].corretora_id) : '';
  onProvCorretoraChange();
}
function onProvCorretoraChange() {
  const t = document.getElementById('provTicker').value;
  const c = document.getElementById('provCorretora').value;
  const pos = getConsolidatedPositions(c || null).find(p => p.ticker === t);
  if (pos && pos.qtdAtual > 0) document.getElementById('provQtd').value = String(pos.qtdAtual).replace('.', ',');
}
async function saveProvento(event) {
  event.preventDefault();
  const ticker = document.getElementById('provTicker').value;
  const tipo = document.getElementById('provTipo').value;
  const data = document.getElementById('provData').value;
  const qtd = parseMoneyField(document.getElementById('provQtd').value);
  const bruto = parseMoneyField(document.getElementById('provBruto').value);
  const imposto = parseMoneyField(document.getElementById('provImposto').value);
  const obs = document.getElementById('provObs').value.trim();
  const provCorr = document.getElementById('provCorretora').value;
  if (!ticker || !data) { showToast('Informe o ativo e a data do pagamento.', 'error'); return; }
  if (!(bruto > 0) || isNaN(imposto) || isNaN(qtd) || imposto < 0 || imposto > bruto) {
    showToast('Confira os valores: bruto > 0 e IR não pode exceder o bruto.', 'error'); return;
  }
  db.run('INSERT INTO proventos (ticker, tipo, data_pagamento, quantidade, valor_bruto, imposto, valor_liquido, observacao, corretora_id) VALUES (?,?,?,?,?,?,?,?,?)',
    [ticker, tipo, data, qtd, bruto, imposto, bruto - imposto, obs, provCorr ? Number(provCorr) : null]);
  await persistSQLiteToIndexedDB();
  ['provBruto', 'provImposto', 'provObs'].forEach(id => { const el = document.getElementById(id); el.value = ''; delete el.dataset.manual; });
  closeProvSheet();
  refreshAllViews();
  showToast(`Provento de ${ticker} registrado!`, 'success');
}
function openProvSheet() {
  const s = document.getElementById('provSheet'); if (!s) return;
  s.classList.remove('hidden');
  const el = document.getElementById('provBruto'); if (el) setTimeout(() => el.focus(), 50);
}
function closeProvSheet() { const s = document.getElementById('provSheet'); if (s) s.classList.add('hidden'); }
let provChart = null;
function renderProvMonthlyChart(rows) {
  const canvas = document.getElementById('provMonthlyChart'); if (!canvas || typeof Chart === 'undefined') return;
  const months = []; const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const m = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ key: `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`, label: m.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '') + '/' + String(m.getFullYear()).slice(2), v: 0 });
  }
  rows.forEach(r => { const m = months.find(x => x.key === String(r.data_pagamento).slice(0, 7)); if (m) m.v += Number(r.valor_liquido) || 0; });
  const total = months.reduce((a, m) => a + m.v, 0);
  const empty = document.getElementById('provChartEmpty'), wrap = document.getElementById('provChartWrap');
  if (empty) empty.classList.toggle('hidden', total > 0);
  if (wrap) wrap.classList.toggle('hidden', total <= 0);
  if (provChart) { provChart.destroy(); provChart = null; }
  if (total <= 0) return;
  provChart = new Chart(canvas.getContext('2d'), {
    type: 'bar', plugins: [autoHideTooltipPlugin()],
    data: { labels: months.map(m => m.label), datasets: [{ data: months.map(m => Number(m.v.toFixed(2))), backgroundColor: '#10b981', borderRadius: 6, maxBarThickness: 22 }] },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${isPrivacyMode ? 'R$ ••••' : formatMoney(c.parsed.y)}` } } },
      scales: { x: { ticks: { color: themeRgb(400), font: { size: 11 } }, grid: { display: false } }, y: { display: false, beginAtZero: true } } }
  });
}
function deleteProvento(id) {
  openConfirmDialog({
    title: 'Excluir provento',
    message: 'Deseja excluir este lançamento de provento?',
    requirePin: Boolean(getSetting('security_pin_hash')),
    onConfirm: async () => {
      db.run('DELETE FROM proventos WHERE id = ?', [id]);
      await persistSQLiteToIndexedDB();
      refreshAllViews();
      showToast('Provento excluído.', 'info');
    }
  });
}
export function renderProventos() {
  const root = document.getElementById('tab-proventos');
  if (!root || !db) return;
  const esc = escapeSavedNoteText;
  const opsTickers = queryAll('SELECT DISTINCT ticker FROM operacoes ORDER BY ticker').map(r => r.ticker);
  const allTickers = Array.from(new Set(opsTickers.concat(queryAll('SELECT DISTINCT ticker FROM proventos').map(r => r.ticker)))).sort();

  const selT = document.getElementById('provTicker');
  const prevT = selT.value;
  selT.innerHTML = opsTickers.length ? opsTickers.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('') : '<option value="">Importe uma nota primeiro</option>';
  if (opsTickers.includes(prevT)) selT.value = prevT;
  const dateEl = document.getElementById('provData');
  if (!dateEl.value) dateEl.value = todayISO();
  if (prevT !== selT.value) onProvTickerChange();

  const selF = document.getElementById('provFilter');
  const prevF = selF.value;
  selF.innerHTML = '<option value="">Todos</option>' + allTickers.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
  if (allTickers.includes(prevF)) selF.value = prevF;

  const fc = (document.getElementById('provFilterCorretora') || {}).value || '';
  const provSql = 'SELECT p.*, (SELECT nome FROM corretoras c WHERE c.id = p.corretora_id) AS corretora_nome FROM proventos p ' + (fc ? 'WHERE p.corretora_id = ? ' : '') + 'ORDER BY p.data_pagamento DESC, p.id DESC';
  const rows = fc ? queryAll(provSql, [Number(fc)]) : queryAll(provSql);
  const posBase = fc ? getConsolidatedPositions(fc) : allPositionsData;
  const sum = (arr, k) => arr.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  const lim = todayISO(-365);
  const last12 = rows.filter(r => r.data_pagamento >= lim);
  document.getElementById('provKpis').innerHTML = [
    ['Total líquido recebido', formatMoney(sum(rows, 'valor_liquido')), 'text-emerald-400'],
    ['Últimos 12 meses', formatMoney(sum(last12, 'valor_liquido')), 'text-white'],
    ['Total bruto', formatMoney(sum(rows, 'valor_bruto')), 'text-white'],
    ['IR retido', formatMoney(sum(rows, 'imposto')), 'text-amber-400']
  ].map(([l, v, c]) => `<div class="glass-card rounded-xl p-3 min-w-0"><span class="block text-[11px] text-slate-400">${l}</span><strong class="block mt-1 text-sm font-mono truncate ${c}">${v}</strong></div>`).join('');

  const byT = {};
  rows.forEach(r => { byT[r.ticker] = (byT[r.ticker] || 0) + (Number(r.valor_liquido) || 0); });
  const tickersWith = Object.keys(byT).sort((a, b) => byT[b] - byT[a]);
  document.getElementById('provByTicker').innerHTML = tickersWith.length ? tickersWith.map(t => {
    const pos = (posBase || []).find(p => p.ticker === t);
    const yoc = pos && pos.valorInvestido > 0 ? formatPercent((byT[t] / pos.valorInvestido) * 100) : '—';
    const rt = pos && pos.valorInvestido > 0 ? `${pos.rentabilidadeTotal >= 0 ? '+' : ''}${formatPercent(pos.rentabilidadeTotal)}` : '—';
    return `<div class="p-3 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between gap-2">
      <div class="min-w-0"><span class="font-mono font-bold text-emerald-400 text-sm">${esc(t)}</span>
        <span class="block text-[11px] text-slate-500">Yield on cost ${yoc} · Rentab. total ${rt}</span></div>
      <strong class="font-mono text-sm text-white shrink-0">${formatMoney(byT[t])}</strong></div>`;
  }).join('') : '<p class="text-xs text-slate-500">Nenhum provento registrado ainda.</p>';

  const f = selF.value;
  const list = f ? rows.filter(r => r.ticker === f) : rows;
  document.getElementById('provList').innerHTML = list.length ? list.map(r => `
    <div class="glass-card rounded-2xl p-3.5 flex items-center justify-between gap-3">
      <div class="min-w-0">
        <div class="flex items-center gap-2"><span class="font-mono font-bold text-emerald-400 text-sm">${esc(r.ticker)}</span>
          <span class="text-[11px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300">${esc(PROV_TIPOS[r.tipo] || r.tipo)}</span></div>
        <p class="text-[11px] text-slate-400 font-mono">${esc(isoToBR(r.data_pagamento))}${r.quantidade > 0 ? ' · ' + esc(formatNumber(r.quantidade)) + ' cotas' : ''}${r.corretora_nome ? ' · ' + esc(r.corretora_nome) : ''}</p>
        ${r.observacao ? `<p class="text-[11px] text-slate-500 truncate">${esc(r.observacao)}</p>` : ''}
      </div>
      <div class="text-right shrink-0">
        <strong class="block font-mono text-sm text-emerald-400">${formatMoney(r.valor_liquido)}</strong>
        <span class="block text-[11px] text-slate-500 font-mono">bruto ${formatMoney(r.valor_bruto)}</span>
      </div>
      <button type="button" onclick="deleteProvento(${Number(r.id)})" aria-label="Excluir provento de ${esc(r.ticker)}" class="p-2 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 transition shrink-0"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
    </div>`).join('') : '<div class="glass-card rounded-2xl p-6 text-center text-xs text-slate-400">Nenhum lançamento para exibir.</div>';
  renderProvMonthlyChart(rows);
  if (window.lucide) lucide.createIcons();
}

// Compatibilidade apenas para handlers inline no HTML/templates.
Object.assign(globalThis, {
  closeProvSheet,
  deleteProvento,
  onProvCorretoraChange,
  onProvTickerChange,
  openProvSheet,
  provAutoTax,
  renderProventos,
  saveProvento
});
