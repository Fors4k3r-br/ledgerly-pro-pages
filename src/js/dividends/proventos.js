// Cadastro, listagem, gráfico mensal, totalização e calendário automático de proventos (dividendos.json).

import { db, isPrivacyMode, allPositionsData } from '../core/state.js';
import { PROV_TIPOS, autoHideTooltipPlugin, escapeSavedNoteText, formatMoney, formatNumber, formatPercent, isoToBR, todayISO } from '../core/utils.js';
import { refreshAllViews } from '../core/events.js';
import { getSetting, persistSQLiteToIndexedDB, queryAll } from '../core/database.js';
import { getConsolidatedPositions } from '../portfolio/positions.js';
import { buildDividendCalendar } from './calendar.js';
import { openConfirmDialog, showToast, themeRgb } from '../ui/navigation.js';

// =========================================================================
// ESTADO DO CALENDÁRIO DE PROVENTOS (agenda via dividendos.json)
// =========================================================================
let activeProvSubView = 'recebidos'; // 'recebidos' | 'calendario'
let activeCalFilter = 'todos'; // 'todos' | 'a_confirmar' | 'previsto' | 'a_definir' | 'registrado'
let showHiddenCalendarItems = false;
const dividendFeedState = { status: 'idle', feed: null, errorMsg: '' };
let dividendFeedPromise = null;
let lastCalendarItems = [];

function formatUnitValueBR(val) {
  const n = Number(val) || 0;
  return 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
}

function formatIsoTimestampBR(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function relativeDateLabel(days, prefix) {
  if (days === null || days === undefined) return '';
  if (days === 0) return `${prefix} hoje`;
  if (days === 1) return `${prefix} amanhã`;
  if (days > 1 && days <= 30) return `${prefix} em ${days}d`;
  return '';
}

export async function loadDividendCalendarFeed(forceRefresh = false) {
  if (dividendFeedPromise && !forceRefresh) return dividendFeedPromise;
  dividendFeedState.status = 'loading';
  dividendFeedState.errorMsg = '';
  renderDividendCalendarSection();

  const run = (async () => {
    try {
      const resp = await fetch('./dividendos.json', { cache: forceRefresh ? 'no-cache' : 'default' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      if (!data || typeof data !== 'object' || Array.isArray(data) || !data.acoes || typeof data.acoes !== 'object') {
        throw new Error('Formato inesperado em dividendos.json.');
      }
      if (data.status === 'offline' && !Object.keys(data.acoes).length) {
        dividendFeedState.status = 'error';
        dividendFeedState.feed = data;
        dividendFeedState.errorMsg = 'Sem conexão para baixar a agenda de proventos pela primeira vez.';
      } else {
        dividendFeedState.status = 'ready';
        dividendFeedState.feed = data;
        dividendFeedState.errorMsg = '';
      }
      return true;
    } catch (err) {
      console.warn('Falha ao carregar dividendos.json:', err);
      if (dividendFeedState.feed && dividendFeedState.feed.acoes && Object.keys(dividendFeedState.feed.acoes).length) {
        dividendFeedState.status = 'ready';
        dividendFeedState.errorMsg = 'Não foi possível atualizar agora; exibindo última cópia carregada.';
      } else {
        dividendFeedState.status = 'error';
        dividendFeedState.errorMsg = 'Não foi possível carregar dividendos.json. Verifique a conexão e tente novamente.';
      }
      return false;
    } finally {
      dividendFeedPromise = null;
      renderDividendCalendarSection();
      if (window.lucide) lucide.createIcons();
    }
  })();

  dividendFeedPromise = run;
  return run;
}

export async function refreshDividendCalendar() {
  const ok = await loadDividendCalendarFeed(true);
  if (ok && dividendFeedState.status === 'ready') {
    showToast('Agenda de proventos atualizada.', 'success');
  } else {
    showToast(dividendFeedState.errorMsg || 'Não foi possível atualizar a agenda.', 'error');
  }
}

export function setProvSubView(view) {
  activeProvSubView = view === 'calendario' ? 'calendario' : 'recebidos';
  updateProvSubViewUI();
  if (activeProvSubView === 'calendario') {
    if (dividendFeedState.status === 'idle') loadDividendCalendarFeed(false);
    else renderDividendCalendarSection();
  }
  if (window.lucide) lucide.createIcons();
}

export function setProvCalFilter(filter) {
  const allowed = ['todos', 'a_confirmar', 'previsto', 'a_definir', 'registrado'];
  activeCalFilter = allowed.includes(filter) ? filter : 'todos';
  renderDividendCalendarSection();
  if (window.lucide) lucide.createIcons();
}

export function toggleHiddenCalendarItems() {
  showHiddenCalendarItems = !showHiddenCalendarItems;
  renderDividendCalendarSection();
  if (window.lucide) lucide.createIcons();
}

function updateProvSubViewUI() {
  const btnRec = document.getElementById('provTab-recebidos');
  const btnCal = document.getElementById('provTab-calendario');
  const panelRec = document.getElementById('provPanel-recebidos');
  const panelCal = document.getElementById('provPanel-calendario');
  if (!btnRec || !btnCal || !panelRec || !panelCal) return;

  const isRec = activeProvSubView === 'recebidos';
  panelRec.classList.toggle('hidden', !isRec);
  panelCal.classList.toggle('hidden', isRec);
  btnRec.className = 'py-2.5 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 '
    + (isRec ? 'bg-emerald-500 text-slate-950 shadow-md' : 'text-slate-300 hover:bg-slate-800/70');
  btnCal.className = 'py-2.5 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 '
    + (!isRec ? 'bg-emerald-500 text-slate-950 shadow-md' : 'text-slate-300 hover:bg-slate-800/70');
}

function updateProvCalendarBadge(count) {
  const badge = document.getElementById('provCalBadge');
  if (!badge) return;
  if (count > 0) {
    badge.textContent = String(count);
    badge.classList.remove('hidden');
  } else {
    badge.textContent = '';
    badge.classList.add('hidden');
  }
}

export function confirmCalendarProvento(eventKey) {
  const item = lastCalendarItems.find(x => x.key === eventKey);
  if (!item) {
    showToast('Evento não encontrado na agenda atual.', 'error');
    return;
  }

  const selT = document.getElementById('provTicker');
  if (selT) {
    if (!Array.from(selT.options).some(o => o.value === item.ticker)) {
      const opt = document.createElement('option');
      opt.value = item.ticker;
      opt.textContent = item.ticker;
      selT.appendChild(opt);
    }
    selT.value = item.ticker;
  }

  const selTipo = document.getElementById('provTipo');
  if (selTipo) selTipo.value = item.tipoCode;

  const selCorr = document.getElementById('provCorretora');
  if (selCorr) {
    const corrVal = item.corretoraId != null ? String(item.corretoraId) : '';
    selCorr.value = Array.from(selCorr.options).some(o => o.value === corrVal) ? corrVal : '';
  }

  const dataEl = document.getElementById('provData');
  if (dataEl) dataEl.value = item.pagamentoIso || todayISO();

  const qtdEl = document.getElementById('provQtd');
  if (qtdEl) qtdEl.value = String(item.qtdNaDataCom).replace('.', ',');

  const brutoEl = document.getElementById('provBruto');
  if (brutoEl) brutoEl.value = item.valorBruto.toFixed(2).replace('.', ',');

  const impEl = document.getElementById('provImposto');
  if (impEl) {
    delete impEl.dataset.manual;
    impEl.value = item.imposto > 0 ? item.imposto.toFixed(2).replace('.', ',') : '';
  }

  const obsEl = document.getElementById('provObs');
  if (obsEl) {
    obsEl.value = `Data-com ${item.dataComBR} · ${formatUnitValueBR(item.valorUnitario)}/cota`.slice(0, 120);
  }

  openProvSheet(true);
}

function renderDividendCalendarSection() {
  const listEl = document.getElementById('provCalList');
  const kpisEl = document.getElementById('provCalKpis');
  const syncEl = document.getElementById('provCalSyncMeta');
  const warnEl = document.getElementById('provCalFeedWarning');
  const chipsEl = document.getElementById('provCalFilterChips');
  const hiddenWrap = document.getElementById('provCalHiddenWrap');
  if (!db) return;

  const esc = escapeSavedNoteText;

  if (dividendFeedState.status === 'loading' && !dividendFeedState.feed) {
    if (syncEl) syncEl.textContent = 'Carregando agenda de dividendos.json…';
    if (listEl) {
      listEl.innerHTML = '<div class="glass-card rounded-2xl p-6 text-center text-xs text-slate-400">Carregando calendário de proventos…</div>';
    }
    return;
  }

  if (dividendFeedState.status === 'error' && !dividendFeedState.feed) {
    if (syncEl) syncEl.textContent = 'Agenda indisponível';
    if (kpisEl) kpisEl.innerHTML = '';
    if (chipsEl) chipsEl.innerHTML = '';
    if (hiddenWrap) { hiddenWrap.innerHTML = ''; hiddenWrap.classList.add('hidden'); }
    if (listEl) {
      listEl.innerHTML = `
        <div class="glass-card rounded-2xl p-5 border border-amber-500/30 bg-amber-500/10 text-center space-y-2">
          <p class="text-xs font-semibold text-amber-300">${esc(dividendFeedState.errorMsg)}</p>
          <button type="button" data-click="refreshDividendCalendar" class="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-semibold text-white transition">Tentar novamente</button>
        </div>`;
    }
    return;
  }

  const ops = queryAll('SELECT id, data_operacao, ticker, tipo_ordem, quantidade, corretora_id FROM operacoes ORDER BY id ASC');
  const registeredProventos = queryAll('SELECT id, ticker, tipo, data_pagamento, valor_bruto, valor_liquido, observacao FROM proventos');
  const cal = buildDividendCalendar({
    feed: dividendFeedState.feed,
    ops,
    registeredProventos,
    todayIso: todayISO()
  });

  lastCalendarItems = cal.items;
  updateProvCalendarBadge(cal.summary.countAConfirmar + cal.summary.countPrevisto + cal.summary.countADefinir);

  if (syncEl) {
    const ts = formatIsoTimestampBR(cal.meta.atualizadoEm);
    syncEl.textContent = ts
      ? `Agenda atualizada em ${ts} · ${cal.meta.totalAtivosFeed} ativos monitorados`
      : `${cal.meta.totalAtivosFeed} ativos monitorados em dividendos.json`;
  }

  if (warnEl) {
    const warnMsg = dividendFeedState.errorMsg
      || (cal.meta.erro ? `Última coleta automática reportou aviso: ${cal.meta.erro}` : '');
    if (warnMsg) {
      warnEl.textContent = warnMsg;
      warnEl.classList.remove('hidden');
    } else {
      warnEl.textContent = '';
      warnEl.classList.add('hidden');
    }
  }

  if (kpisEl) {
    const nextSub = cal.summary.proximoPagamento
      ? `Próx.: ${cal.summary.proximoPagamento.ticker} em ${cal.summary.proximoPagamento.pagamentoBR}`
      : (cal.summary.countADefinir > 0 ? `${cal.summary.countADefinir} com pagamento a definir` : 'Sem pagamentos futuros');
    const confirmSub = cal.summary.countAConfirmar > 0
      ? `${cal.summary.countAConfirmar} ${cal.summary.countAConfirmar === 1 ? 'pagamento vencido' : 'pagamentos vencidos'}`
      : 'Tudo em dia';

    kpisEl.innerHTML = `
      <div class="glass-card rounded-2xl p-3.5 min-w-0 space-y-1">
        <span class="block text-[11px] text-slate-400">Previsto a receber</span>
        <strong class="block text-sm font-extrabold font-mono text-emerald-400 truncate">${formatMoney(cal.summary.totalPrevistoLiquido)}</strong>
        <span class="block text-[10px] text-slate-500 truncate">${esc(nextSub)}</span>
      </div>
      <div class="glass-card rounded-2xl p-3.5 min-w-0 space-y-1">
        <span class="block text-[11px] text-slate-400">A confirmar</span>
        <strong class="block text-sm font-extrabold font-mono ${cal.summary.countAConfirmar > 0 ? 'text-amber-300' : 'text-white'} truncate">${formatMoney(cal.summary.totalAConfirmarLiquido)}</strong>
        <span class="block text-[10px] text-slate-500 truncate">${esc(confirmSub)}</span>
      </div>`;
  }

  if (chipsEl) {
    const defs = [
      ['todos', `Todos (${cal.summary.total})`],
      ['a_confirmar', `A confirmar (${cal.summary.countAConfirmar})`],
      ['previsto', `Previstos (${cal.summary.countPrevisto})`],
      ['a_definir', `A definir (${cal.summary.countADefinir})`],
      ['registrado', `Lançados (${cal.summary.countRegistrado})`]
    ];
    chipsEl.innerHTML = defs.map(([id, label]) => {
      const on = activeCalFilter === id;
      const cls = on
        ? 'bg-emerald-500 text-slate-950 border-emerald-500 font-bold'
        : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border-slate-800 font-semibold';
      return `<button type="button" data-click="setProvCalFilter" data-arg="${id}" class="shrink-0 whitespace-nowrap px-3 py-1.5 rounded-full border text-[11px] transition ${cls}">${esc(label)}</button>`;
    }).join('');
  }

  if (hiddenWrap) {
    const hidden = cal.hiddenItems || [];
    if (hidden.length > 0) {
      const n = hidden.length;
      const tCount = cal.summary.hiddenTickerCount || 0;
      const countText = n === 1 ? '1 provento ocultado' : `${n} proventos ocultados`;
      const assetsText = (tCount > 0 && tCount !== n)
        ? ` (${tCount} ${tCount === 1 ? 'ativo' : 'ativos'})`
        : '';
      const toggleLabel = showHiddenCalendarItems ? 'Ocultar' : 'Ver quais';
      const chevronIcon = showHiddenCalendarItems ? 'chevron-up' : 'chevron-down';

      const cardsHtml = showHiddenCalendarItems
        ? `<div class="space-y-2.5">${hidden.map(h => `
            <article class="glass-card rounded-2xl p-3.5 border border-slate-800 space-y-2.5">
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0 flex items-center gap-1.5 flex-wrap">
                  <strong class="font-mono text-sm font-extrabold text-slate-200">${esc(h.ticker)}</strong>
                  <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-800 text-slate-300">${esc(PROV_TIPOS[h.tipoCode] || h.tipoRaw)}</span>
                  <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 text-slate-400">Sem direito</span>
                </div>
                <span class="shrink-0 font-mono text-[11px] text-slate-400 whitespace-nowrap">${esc(formatUnitValueBR(h.valorUnitario))}/cota</span>
              </div>
              <dl class="rounded-xl bg-slate-950/80 border border-slate-800/80 px-3 divide-y divide-slate-800/70">
                <div class="flex items-baseline justify-between gap-2 py-1.5 text-[11px]">
                  <dt class="text-slate-400">Prazo para ter direito (data-com)</dt>
                  <dd class="font-mono text-slate-200 whitespace-nowrap">${esc(h.dataComBR)}</dd>
                </div>
                <div class="flex items-baseline justify-between gap-2 py-1.5 text-[11px]">
                  <dt class="text-slate-400">${esc(h.purchaseDateLabel)}</dt>
                  <dd class="font-mono text-slate-200 whitespace-nowrap">${esc(h.purchaseDateBR)}</dd>
                </div>
                <div class="flex items-baseline justify-between gap-2 py-1.5 text-[11px]">
                  <dt class="text-slate-400">Pagamento</dt>
                  <dd class="font-mono text-slate-400 whitespace-nowrap">${esc(h.pagamentoBR)}</dd>
                </div>
              </dl>
            </article>`).join('')}</div>`
        : '';

      hiddenWrap.innerHTML = `
        <button
          type="button"
          data-click="toggleHiddenCalendarItems"
          aria-expanded="${showHiddenCalendarItems ? 'true' : 'false'}"
          class="w-full glass-card rounded-2xl p-3.5 border border-slate-800 hover:bg-slate-800/40 text-left transition flex items-center justify-between gap-3"
        >
          <span class="text-[11px] text-slate-400 leading-relaxed min-w-0">
            <strong class="text-slate-200 font-semibold">${esc(countText + assetsText)}:</strong>
            o prazo para ter direito foi antes da sua compra.
          </span>
          <span class="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400 whitespace-nowrap">
            <span>${toggleLabel}</span>
            <i data-lucide="${chevronIcon}" class="w-4 h-4"></i>
          </span>
        </button>
        ${cardsHtml}`;
      hiddenWrap.classList.remove('hidden');
    } else {
      showHiddenCalendarItems = false;
      hiddenWrap.innerHTML = '';
      hiddenWrap.classList.add('hidden');
    }
  }

  if (!listEl) return;

  if (!ops.length) {
    listEl.innerHTML = `
      <div class="glass-card rounded-2xl p-6 text-center space-y-1.5">
        <p class="text-sm font-semibold text-slate-300">Nenhum ativo na carteira ainda</p>
        <p class="text-xs text-slate-500">Importe uma nota de corretagem ou lance uma compra para cruzar automaticamente com a agenda de proventos.</p>
      </div>`;
    return;
  }

  const filtered = activeCalFilter === 'todos'
    ? cal.items
    : cal.items.filter(item => item.status === activeCalFilter);

  if (!filtered.length) {
    const emptyMsg = cal.items.length === 0
      ? 'Nenhum provento previsto encontrado em dividendos.json para a sua custódia atual.'
      : 'Nenhum evento encontrado neste filtro.';
    listEl.innerHTML = `<div class="glass-card rounded-2xl p-6 text-center text-xs text-slate-400">${esc(emptyMsg)}</div>`;
    return;
  }

  listEl.innerHTML = filtered.map(item => {
    let statusBadge = '';
    let borderCls = 'border-slate-800';
    if (item.status === 'a_confirmar') {
      statusBadge = '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-300">A confirmar</span>';
      borderCls = 'border-amber-500/30';
    } else if (item.status === 'previsto') {
      const soon = relativeDateLabel(item.daysToPay, 'Paga');
      statusBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-300">${esc(soon || 'Previsto')}</span>`;
      borderCls = 'border-emerald-500/30';
    } else if (item.status === 'a_definir') {
      statusBadge = '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/15 text-indigo-300">Data a definir</span>';
      borderCls = 'border-indigo-500/30';
    } else {
      statusBadge = '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 text-slate-400">Lançado</span>';
    }

    const comSoon = relativeDateLabel(item.daysToCom, 'Com');
    const exSoon = relativeDateLabel(item.daysToEx, 'Ex');
    const milestoneTag = comSoon || exSoon;

    const actionBtn = item.status === 'registrado'
      ? ''
      : item.status === 'a_confirmar'
        ? `<button type="button" data-click="confirmCalendarProvento" data-arg="${esc(item.key)}" class="w-full py-2.5 px-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs transition flex items-center justify-center gap-1.5"><i data-lucide="calendar-check" class="w-4 h-4"></i><span>Confirmar recebimento</span></button>`
        : `<button type="button" data-click="confirmCalendarProvento" data-arg="${esc(item.key)}" class="w-full py-2 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 font-semibold text-xs transition flex items-center justify-center gap-1.5"><i data-lucide="plus" class="w-3.5 h-3.5"></i><span>Lançar provento</span></button>`;

    return `
      <article class="glass-card rounded-2xl p-4 border ${borderCls} space-y-3">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0 space-y-1">
            <div class="flex items-center gap-1.5 flex-wrap">
              <strong class="font-mono text-sm font-extrabold text-white">${esc(item.ticker)}</strong>
              <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-800 text-slate-300">${esc(PROV_TIPOS[item.tipoCode] || item.tipoRaw)}</span>
              ${statusBadge}
              ${milestoneTag ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-500/15 text-indigo-300">${esc(milestoneTag)}</span>` : ''}
            </div>
            <p class="text-[11px] text-slate-400 font-mono">
              ${esc(
                item.isFutureCom
                  ? `${formatNumber(item.qtdNaDataCom)} cotas atuais`
                  : item.isSoldAfterCom
                    ? `${formatNumber(item.qtdNaDataCom)} cotas na data limite (posição encerrada)`
                    : item.isPartialRight && item.qtdAtual > item.qtdNaDataCom
                      ? `${formatNumber(item.qtdNaDataCom)} de ${formatNumber(item.qtdAtual)} cotas tinham direito na data limite`
                      : item.isPartialRight
                        ? `${formatNumber(item.qtdNaDataCom)} cotas na data limite (atual: ${formatNumber(item.qtdAtual)})`
                        : `${formatNumber(item.qtdNaDataCom)} cotas na data limite`
              )} · ${esc(formatUnitValueBR(item.valorUnitario))}
            </p>
          </div>
          <div class="text-right shrink-0">
            <strong class="block font-mono text-sm font-extrabold ${item.status === 'registrado' ? 'text-slate-300' : 'text-emerald-400'} whitespace-nowrap">${formatMoney(item.valorLiquido)}</strong>
            <span class="block text-[10px] text-slate-500 font-mono whitespace-nowrap">${item.imposto > 0 ? `líq. (IR ${formatMoney(item.imposto)})` : 'líquido estimado'}</span>
          </div>
        </div>

        <dl class="rounded-xl bg-slate-950/80 border border-slate-800/80 px-3 divide-y divide-slate-800/70">
          <div class="flex items-baseline justify-between gap-2 py-1.5 text-[11px]">
            <dt class="text-slate-400">Data limite (data-com)</dt>
            <dd class="font-mono text-slate-200 whitespace-nowrap">${esc(item.dataComBR)}</dd>
          </div>
          <div class="flex items-baseline justify-between gap-2 py-1.5 text-[11px]">
            <dt class="text-slate-400">Data-ex</dt>
            <dd class="font-mono text-slate-200 whitespace-nowrap">${esc(item.dataExBR)}</dd>
          </div>
          <div class="flex items-baseline justify-between gap-2 py-1.5 text-[11px]">
            <dt class="text-slate-400">Pagamento</dt>
            <dd class="font-mono font-semibold ${item.pagamentoIndefinido ? 'text-indigo-300' : 'text-white'} whitespace-nowrap">${esc(item.pagamentoBR)}</dd>
          </div>
          ${item.imposto > 0 ? `
          <div class="flex items-baseline justify-between gap-2 py-1.5 text-[11px]">
            <dt class="text-slate-400">Bruto / IR JCP (15%)</dt>
            <dd class="font-mono text-slate-300 whitespace-nowrap">${formatMoney(item.valorBruto)} · −${formatMoney(item.imposto)}</dd>
          </div>` : ''}
        </dl>

        ${actionBtn}
      </article>`;
  }).join('');
}

// =========================================================================
// PROVENTOS RECEBIDOS (cadastro, listagem, gráfico mensal e totalização)
// =========================================================================
function parseMoneyField(v) {
  const s = String(v || '').trim().replace(/\s/g, '');
  if (!s) return 0;
  const n = s.includes(',') ? parseFloat(s.replace(/\./g, '').replace(',', '.')) : parseFloat(s);
  return isFinite(n) ? n : NaN;
}
export function provAutoTax() {
  const imp = document.getElementById('provImposto');
  if (!imp || imp.dataset.manual === '1') return;
  const bruto = parseMoneyField(document.getElementById('provBruto').value);
  const jcp = document.getElementById('provTipo').value === 'JCP';
  imp.value = jcp && bruto > 0 ? (bruto * 0.15).toFixed(2).replace('.', ',') : '';
}
export function onProvTickerChange() {
  const t = document.getElementById('provTicker').value;
  // Sugere a corretora onde o ativo tem a maior custódia atual
  const rows = queryAll(`SELECT corretora_id, SUM(CASE WHEN tipo_ordem = 'C' THEN quantidade ELSE -quantidade END) AS q FROM operacoes WHERE ticker = ? GROUP BY corretora_id ORDER BY q DESC`, [t]);
  const sel = document.getElementById('provCorretora');
  sel.value = (rows.length && rows[0].corretora_id != null) ? String(rows[0].corretora_id) : '';
  onProvCorretoraChange();
}
export function onProvCorretoraChange() {
  const t = document.getElementById('provTicker').value;
  const c = document.getElementById('provCorretora').value;
  const pos = getConsolidatedPositions(c || null).find(p => p.ticker === t);
  if (pos && pos.qtdAtual > 0) document.getElementById('provQtd').value = String(pos.qtdAtual).replace('.', ',');
}
export async function saveProvento(event) {
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
export function openProvSheet(prefilled = false) {
  const s = document.getElementById('provSheet'); if (!s) return;
  const titleEl = document.getElementById('provSheetTitle');
  if (titleEl) titleEl.textContent = prefilled ? 'Confirmar provento' : 'Novo provento';
  s.classList.remove('hidden');
  const el = document.getElementById('provBruto'); if (el) setTimeout(() => el.focus(), 50);
}
export function closeProvSheet() { const s = document.getElementById('provSheet'); if (s) s.classList.add('hidden'); }
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
export function deleteProvento(id) {
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
  updateProvSubViewUI();

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
      <button type="button" data-click="deleteProvento" data-arg="${Number(r.id)}" aria-label="Excluir provento de ${esc(r.ticker)}" class="p-2 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 transition shrink-0"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
    </div>`).join('') : '<div class="glass-card rounded-2xl p-6 text-center text-xs text-slate-400">Nenhum lançamento para exibir.</div>';
  renderProvMonthlyChart(rows);

  // Carrega a agenda automaticamente ao abrir a aba Proventos (ou redesenha se já carregada)
  const isProvTabVisible = !root.classList.contains('hidden');
  if (dividendFeedState.status === 'idle' && isProvTabVisible) {
    loadDividendCalendarFeed(false);
  } else if (dividendFeedState.status !== 'idle') {
    renderDividendCalendarSection();
  }

  if (window.lucide) lucide.createIcons();
}
