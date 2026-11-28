// Tela de Conferência da carteira: auditoria automática do banco e batimento de custódia (manual ou CSV/Excel).

import { db, dailyDb } from '../core/state.js';
import { escapeSavedNoteText, formatMoney, formatNumber } from '../core/utils.js';
import { getSetting, queryAll, rowsFromDatabase } from '../core/database.js';
import { getConsolidatedPositions } from './positions.js';
import { buildCustodyReconciliation, runPortfolioAudit } from './audit.js';
import { parsePositionFile } from './position-import.js';
import { showToast } from '../ui/navigation.js';

const AUDIT_LS_KEY = 'ledgerly_audit_state_v1';

let activeAuditSubView = 'auditoria'; // 'auditoria' | 'batimento'
let importedPositionData = null; // mantido em memória durante a sessão de conferência

function loadAuditState() {
  try {
    const raw = localStorage.getItem(AUDIT_LS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      checked: (parsed && typeof parsed.checked === 'object' && parsed.checked) ? parsed.checked : {},
      manual: (parsed && typeof parsed.manual === 'object' && parsed.manual) ? parsed.manual : {},
      lastCheckedAt: parsed && parsed.lastCheckedAt ? String(parsed.lastCheckedAt) : null
    };
  } catch (_) {
    return { checked: {}, manual: {}, lastCheckedAt: null };
  }
}

function saveAuditState(state) {
  try {
    localStorage.setItem(AUDIT_LS_KEY, JSON.stringify(state));
  } catch (_) {}
}

function getDbIntegrityStatus() {
  const result = { centralOk: true, centralFkIssues: 0, dailyOk: true, dailyFkIssues: 0 };
  try {
    if (db) {
      const check = rowsFromDatabase(db, 'PRAGMA integrity_check');
      result.centralOk = Boolean(check.length && check[0].integrity_check === 'ok');
      result.centralFkIssues = rowsFromDatabase(db, 'PRAGMA foreign_key_check').length;
    }
  } catch (_) {
    result.centralOk = false;
  }
  try {
    if (dailyDb) {
      const check = rowsFromDatabase(dailyDb, 'PRAGMA integrity_check');
      result.dailyOk = Boolean(check.length && check[0].integrity_check === 'ok');
      result.dailyFkIssues = rowsFromDatabase(dailyDb, 'PRAGMA foreign_key_check').length;
    }
  } catch (_) {
    result.dailyOk = false;
  }
  return result;
}

function getActiveExternalMap() {
  if (!importedPositionData) return null;
  const instSel = document.getElementById('auditFileInst');
  const selectedInst = instSel ? instSel.value : '';
  if (selectedInst && importedPositionData.byInstitution[selectedInst]) {
    return importedPositionData.byInstitution[selectedInst];
  }
  return importedPositionData.byTicker;
}

function renderAuditIssueCard(item, tone) {
  const esc = escapeSavedNoteText;
  const boxCls = tone === 'critical'
    ? 'border-rose-500/30 bg-rose-500/15'
    : 'border-amber-500/30 bg-amber-500/10';
  const badgeCls = tone === 'critical'
    ? 'bg-rose-500/20 text-rose-300'
    : 'bg-amber-500/20 text-amber-300';
  const btnCls = tone === 'critical'
    ? 'bg-slate-900/90 hover:bg-slate-800 border-rose-500/30 text-rose-300'
    : 'bg-slate-900/90 hover:bg-slate-800 border-amber-500/30 text-amber-300';
  const argAttr = item.actionArg ? ` data-arg="${esc(item.actionArg)}"` : '';

  return `
    <div class="rounded-2xl border p-3.5 space-y-2 ${boxCls}">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0 space-y-1">
          <span class="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${badgeCls}">${esc(item.category)}</span>
          <h4 class="text-xs font-bold text-white leading-snug">${esc(item.title)}</h4>
        </div>
        ${item.action ? `<button type="button" data-click="${esc(item.action)}"${argAttr} class="shrink-0 px-2.5 py-1.5 rounded-xl border text-[11px] font-semibold transition ${btnCls}">${esc(item.actionLabel || 'Abrir')}</button>` : ''}
      </div>
      <p class="text-[11px] text-slate-300 leading-relaxed">${esc(item.detail)}</p>
    </div>`;
}

function renderAuditDiagnosticsSection() {
  const container = document.getElementById('auditDiagnosticsContainer');
  if (!container || !db) return;

  const ops = queryAll('SELECT * FROM operacoes ORDER BY id ASC');
  const notes = queryAll('SELECT id, numero_controle, data_pregao, valor_operacoes, valor_liquido_nota, corretora_id FROM notas_corretagem ORDER BY id DESC');
  const quotesRows = queryAll('SELECT ticker, preco_atual FROM cotacoes_atuais');
  const provRows = queryAll('SELECT id, ticker, corretora_id FROM proventos');
  const positions = getConsolidatedPositions();
  const brapiLastSyncIso = getSetting('brapi_last_sync_iso');
  const dbIntegrity = getDbIntegrityStatus();

  const report = runPortfolioAudit({
    ops,
    notes,
    quotesRows,
    provRows,
    positions,
    brapiLastSyncIso,
    dbIntegrity
  });

  const dbOk = dbIntegrity.centralOk && dbIntegrity.dailyOk && dbIntegrity.centralFkIssues === 0 && dbIntegrity.dailyFkIssues === 0;

  const critEl = document.getElementById('auditKpiCritical');
  const warnEl = document.getElementById('auditKpiWarnings');
  const dbEl = document.getElementById('auditKpiDb');
  if (critEl) {
    critEl.textContent = String(report.stats.criticalCount);
    critEl.className = 'text-xl font-extrabold font-mono ' + (report.stats.criticalCount > 0 ? 'text-rose-400' : 'text-emerald-400');
  }
  if (warnEl) {
    warnEl.textContent = String(report.stats.warningCount);
    warnEl.className = 'text-xl font-extrabold font-mono ' + (report.stats.warningCount > 0 ? 'text-amber-400' : 'text-emerald-400');
  }
  if (dbEl) {
    dbEl.textContent = dbOk ? 'OK' : 'Erro';
    dbEl.className = 'text-xl font-extrabold font-mono ' + (dbOk ? 'text-emerald-400' : 'text-rose-400');
  }

  if (report.stats.totalOps === 0 && report.stats.totalNotes === 0) {
    container.innerHTML = `
      <div class="glass-card rounded-2xl p-6 text-center space-y-2">
        <p class="text-sm font-semibold text-slate-300">Nenhuma operação registrada para auditar</p>
        <p class="text-xs text-slate-500">Importe uma nota de corretagem ou lance uma operação manual para executar as verificações automáticas.</p>
      </div>`;
    return;
  }

  if (report.critical.length === 0 && report.warnings.length === 0) {
    container.innerHTML = `
      <div class="glass-card rounded-2xl p-5 border border-emerald-500/30 bg-emerald-500/10 flex items-start gap-3">
        <i data-lucide="check-circle-2" class="w-5 h-5 text-emerald-400 shrink-0 mt-0.5"></i>
        <div class="space-y-1">
          <h3 class="text-sm font-bold text-emerald-300">Carteira íntegra e sem divergências</h3>
          <p class="text-xs text-slate-300">Verificadas ${report.stats.totalOps} operações, ${report.stats.totalNotes} notas e integridade física de central.db e daily.db sem inconsistências.</p>
        </div>
      </div>`;
    return;
  }

  let html = '';
  if (report.critical.length > 0) {
    html += `
      <div class="space-y-2.5">
        <h3 class="text-xs font-bold uppercase tracking-wider text-rose-300 flex items-center gap-1.5">
          <i data-lucide="alert-circle" class="w-4 h-4"></i>
          Divergências críticas (${report.critical.length})
        </h3>
        <div class="space-y-2">${report.critical.map(item => renderAuditIssueCard(item, 'critical')).join('')}</div>
      </div>`;
  }
  if (report.warnings.length > 0) {
    html += `
      <div class="space-y-2.5">
        <h3 class="text-xs font-bold uppercase tracking-wider text-amber-300 flex items-center gap-1.5">
          <i data-lucide="alert-triangle" class="w-4 h-4"></i>
          Pendências de organização (${report.warnings.length})
        </h3>
        <div class="space-y-2">${report.warnings.map(item => renderAuditIssueCard(item, 'warning')).join('')}</div>
      </div>`;
  }
  container.innerHTML = html;
}

function renderImportedFileBanner() {
  const banner = document.getElementById('auditFileBanner');
  const instWrap = document.getElementById('auditFileInstWrap');
  const instSel = document.getElementById('auditFileInst');
  if (!banner) return;

  if (!importedPositionData) {
    banner.classList.add('hidden');
    if (instWrap) instWrap.classList.add('hidden');
    return;
  }

  const esc = escapeSavedNoteText;
  const infoEl = document.getElementById('auditFileMeta');
  if (infoEl) {
    const sheetsInfo = importedPositionData.sheetsParsed.length > 1
      ? ` · ${importedPositionData.sheetsParsed.length} abas`
      : '';
    const colsInfo = importedPositionData.detectedColumns.length
      ? `Colunas: ${importedPositionData.detectedColumns.join(' · ')}`
      : '';
    infoEl.innerHTML = `
      <strong class="block text-xs text-emerald-300 truncate">${esc(importedPositionData.fileName)}</strong>
      <span class="block text-[11px] text-slate-300">${importedPositionData.totalTickers} ${importedPositionData.totalTickers === 1 ? 'ativo lido' : 'ativos lidos'} (${importedPositionData.format.toUpperCase()}${sheetsInfo})</span>
      ${colsInfo ? `<span class="block text-[10px] text-slate-400 truncate">${esc(colsInfo)}</span>` : ''}`;
  }
  banner.classList.remove('hidden');

  if (instWrap && instSel) {
    if (importedPositionData.institutions.length > 1) {
      const prev = instSel.value;
      instSel.innerHTML = '<option value="">Todas as instituições do arquivo</option>'
        + importedPositionData.institutions.map(inst => `<option value="${esc(inst)}">${esc(inst)}</option>`).join('');
      if (importedPositionData.institutions.includes(prev)) instSel.value = prev;
      instWrap.classList.remove('hidden');
    } else {
      instSel.innerHTML = '<option value="">Todas as instituições do arquivo</option>';
      instWrap.classList.add('hidden');
    }
  }
}

function renderReconciliationSection() {
  const listEl = document.getElementById('auditReconciliationList');
  const summaryEl = document.getElementById('auditProgressSummary');
  const barEl = document.getElementById('auditProgressBar');
  const lastEl = document.getElementById('auditLastCheckedLabel');
  if (!listEl || !db) return;

  renderImportedFileBanner();

  const corrSel = document.getElementById('auditCorretora');
  const corrId = corrSel ? corrSel.value : '';
  const positions = corrId ? getConsolidatedPositions(corrId) : getConsolidatedPositions();
  const state = loadAuditState();
  const externalMap = getActiveExternalMap();

  const { rows, summary } = buildCustodyReconciliation({
    positions,
    externalMap,
    manualMap: state.manual,
    checkedMap: state.checked
  });

  const pct = summary.total > 0 ? Math.round((summary.conferidos / summary.total) * 100) : 0;
  if (summaryEl) {
    summaryEl.textContent = summary.total > 0
      ? `${summary.conferidos} de ${summary.total} conferidos · ${summary.divergentes} ${summary.divergentes === 1 ? 'divergência' : 'divergências'}`
      : 'Nenhum ativo aberto para conferir';
  }
  if (barEl) {
    barEl.style.width = `${pct}%`;
  }
  if (lastEl) {
    lastEl.textContent = state.lastCheckedAt
      ? `Última conferência: ${new Date(state.lastCheckedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`
      : 'Nenhuma conferência marcada ainda';
  }

  if (!rows.length) {
    listEl.innerHTML = `
      <div class="glass-card rounded-2xl p-6 text-center space-y-2">
        <p class="text-sm font-semibold text-slate-300">Nenhum ativo em custódia neste filtro</p>
        <p class="text-xs text-slate-500">Importe um arquivo CSV/Excel da B3 ou corretora, ou selecione "Todas as corretoras" para iniciar o batimento.</p>
      </div>`;
    return;
  }

  const esc = escapeSavedNoteText;
  listEl.innerHTML = rows.map(row => {
    const statusBadge = row.status === 'ok'
      ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-300">Conferido</span>'
      : row.status === 'divergente'
        ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/15 text-rose-300">${row.onlyInFile ? 'Só no arquivo' : row.onlyInAppWithFile ? 'Falta no arquivo' : 'Divergente'}</span>`
        : '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 text-slate-400">Pendente</span>';

    const cardBorder = row.status === 'divergente'
      ? 'border-rose-500/30'
      : row.status === 'ok'
        ? 'border-emerald-500/30'
        : 'border-slate-800';

    let diffText = 'Informe a quantidade na corretora ou importe um arquivo';
    let diffCls = 'text-slate-500';
    if (row.onlyInFile) {
      diffText = `Consta ${formatNumber(row.qtdRef)} no arquivo e 0 no app`;
      diffCls = 'text-rose-300 font-semibold';
    } else if (row.onlyInAppWithFile) {
      diffText = `Consta ${formatNumber(row.qtdApp)} no app e não apareceu no arquivo`;
      diffCls = 'text-rose-300 font-semibold';
    } else if (row.diff !== null) {
      if (Math.abs(row.diff) <= 1e-6) {
        diffText = 'Quantidade confere exatamente';
        diffCls = 'text-emerald-400 font-semibold';
      } else {
        const sign = row.diff > 0 ? '+' : '';
        diffText = `Diferença (app − ref.): ${sign}${formatNumber(row.diff)}`;
        diffCls = 'text-rose-300 font-semibold';
      }
    }

    const inputVal = row.qtdRef !== null ? String(row.qtdRef) : '';
    const checkBtnCls = row.manualChecked
      ? 'bg-emerald-500 text-slate-950 border-emerald-500 font-bold'
      : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border-slate-700 font-semibold';

    return `
      <div class="glass-card rounded-2xl p-3.5 border ${cardBorder} space-y-2.5" data-audit-row="${esc(row.ticker)}">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <strong class="font-mono text-sm font-extrabold text-white">${esc(row.ticker)}</strong>
              ${statusBadge}
              ${row.refSource === 'arquivo' ? '<span class="text-[10px] text-indigo-300 font-semibold">via arquivo</span>' : ''}
            </div>
            <p class="text-[11px] text-slate-400 font-mono mt-0.5">
              App: <b class="text-slate-200">${formatNumber(row.qtdApp)}</b>${row.qtdApp > 0 ? ` · PM ${formatMoney(row.precoMedio)} · Custo ${formatMoney(row.valorInvestido)}` : ''}
            </p>
            ${row.extInstitutions.length ? `<p class="text-[10px] text-slate-500 truncate">Arquivo: ${esc(row.extInstitutions.join(', '))}</p>` : ''}
          </div>
          ${row.qtdApp > 0 ? `<button type="button" data-click="focusTicker" data-arg="${esc(row.ticker)}" class="shrink-0 p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-white transition" title="Ver ativo em Ativos" aria-label="Ver ${esc(row.ticker)} em Ativos"><i data-lucide="chevron-right" class="w-4 h-4"></i></button>` : ''}
        </div>

        <div class="flex items-center gap-2">
          <div class="flex-1 min-w-0">
            <label class="block text-[10px] text-slate-400 mb-0.5">Qtd na B3 / corretora</label>
            <input
              type="number"
              step="any"
              value="${esc(inputVal)}"
              placeholder="${formatNumber(row.qtdApp)}"
              aria-label="Quantidade real de ${esc(row.ticker)} na B3 ou corretora"
              data-input="setAuditManualQty"
              data-change="commitAuditManualQty"
              data-ticker="${esc(row.ticker)}"
              class="w-full bg-slate-950 border border-slate-700 focus:border-emerald-500 rounded-xl px-3 py-2 text-xs font-mono text-white outline-none"
            />
          </div>
          <div class="pt-4 shrink-0">
            <button
              type="button"
              data-click="toggleAuditChecked"
              data-arg="${esc(row.ticker)}"
              class="px-3 py-2 rounded-xl border text-xs transition flex items-center gap-1.5 ${checkBtnCls}"
            >
              <i data-lucide="check" class="w-3.5 h-3.5"></i>
              <span>${row.manualChecked ? 'OK' : 'Conferir'}</span>
            </button>
          </div>
        </div>
        <p class="text-[11px] font-mono ${diffCls}" data-audit-diff="${esc(row.ticker)}">${esc(diffText)}</p>
      </div>`;
  }).join('');
}

export function renderAuditView() {
  if (!db) return;

  const btnAud = document.getElementById('auditTab-auditoria');
  const btnBat = document.getElementById('auditTab-batimento');
  const panelAud = document.getElementById('auditPanel-auditoria');
  const panelBat = document.getElementById('auditPanel-batimento');

  if (btnAud && btnBat && panelAud && panelBat) {
    const isAud = activeAuditSubView === 'auditoria';
    panelAud.classList.toggle('hidden', !isAud);
    panelBat.classList.toggle('hidden', isAud);
    btnAud.className = 'py-2.5 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 '
      + (isAud ? 'bg-emerald-500 text-slate-950 shadow-md' : 'text-slate-300 hover:bg-slate-800/70');
    btnBat.className = 'py-2.5 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 '
      + (!isAud ? 'bg-emerald-500 text-slate-950 shadow-md' : 'text-slate-300 hover:bg-slate-800/70');
  }

  renderAuditDiagnosticsSection();
  renderReconciliationSection();
  if (window.lucide) lucide.createIcons();
}

export function setAuditSubView(view) {
  activeAuditSubView = view === 'batimento' ? 'batimento' : 'auditoria';
  renderAuditView();
}

export function onAuditCorretoraChange() {
  renderReconciliationSection();
  if (window.lucide) lucide.createIcons();
}

export function onAuditFileInstChange() {
  renderReconciliationSection();
  if (window.lucide) lucide.createIcons();
}

export async function handleAuditFileImport(event) {
  const input = event.target;
  const file = input?.files?.[0];
  if (input) input.value = '';
  if (!file) return;

  try {
    const parsed = await parsePositionFile(file);
    importedPositionData = parsed;
    // Limpa sobreescritas manuais anteriores para refletir os números recém-importados do arquivo
    const state = loadAuditState();
    state.manual = {};
    saveAuditState(state);
    activeAuditSubView = 'batimento';
    renderAuditView();
    showToast(`${parsed.totalTickers} ativo(s) carregado(s) de ${parsed.fileName}.`, 'success');
  } catch (err) {
    console.error('Erro ao ler arquivo de custódia:', err);
    showToast((err && err.message) || 'Não foi possível ler o arquivo selecionado.', 'error');
  }
}

export function clearAuditImportedFile() {
  importedPositionData = null;
  renderAuditView();
  showToast('Arquivo de comparação removido.', 'info');
}

export function setAuditManualQty(ticker, rawVal, shouldRerender = false) {
  const t = String(ticker || '').toUpperCase().trim();
  if (!t) return;
  const state = loadAuditState();
  const clean = String(rawVal ?? '').trim();

  if (clean === '') {
    delete state.manual[t];
  } else {
    const num = Number(clean.replace(',', '.'));
    if (!Number.isFinite(num) || num < 0) return;
    state.manual[t] = num;
  }
  state.lastCheckedAt = new Date().toISOString();
  saveAuditState(state);

  if (shouldRerender) {
    renderReconciliationSection();
    if (window.lucide) lucide.createIcons();
    return;
  }

  // Atualização leve em tempo real sem perder foco do input no celular
  const diffEl = document.querySelector(`[data-audit-diff="${CSS.escape(t)}"]`);
  if (!diffEl) return;
  const corrSel = document.getElementById('auditCorretora');
  const corrId = corrSel ? corrSel.value : '';
  const positions = corrId ? getConsolidatedPositions(corrId) : getConsolidatedPositions();
  const pos = positions.find(p => p.ticker === t && p.qtdAtual > 0);
  const qtdApp = pos ? Number(pos.qtdAtual) || 0 : 0;
  const ext = getActiveExternalMap()?.[t];
  const ref = clean !== '' ? Number(clean.replace(',', '.')) : (ext ? Number(ext.quantidade) : null);

  if (ref === null || !Number.isFinite(ref)) {
    diffEl.textContent = 'Informe a quantidade na corretora ou importe um arquivo';
    diffEl.className = 'text-[11px] font-mono text-slate-500';
  } else {
    const d = Number((qtdApp - ref).toFixed(8));
    if (Math.abs(d) <= 1e-6) {
      diffEl.textContent = 'Quantidade confere exatamente';
      diffEl.className = 'text-[11px] font-mono text-emerald-400 font-semibold';
    } else {
      const sign = d > 0 ? '+' : '';
      diffEl.textContent = `Diferença (app − ref.): ${sign}${formatNumber(d)}`;
      diffEl.className = 'text-[11px] font-mono text-rose-300 font-semibold';
    }
  }
}

export function toggleAuditChecked(ticker) {
  const t = String(ticker || '').toUpperCase().trim();
  if (!t) return;
  const state = loadAuditState();
  if (state.checked[t]) delete state.checked[t];
  else state.checked[t] = true;
  state.lastCheckedAt = new Date().toISOString();
  saveAuditState(state);
  renderReconciliationSection();
  if (window.lucide) lucide.createIcons();
}

export function markAllMatchingChecked() {
  const corrSel = document.getElementById('auditCorretora');
  const corrId = corrSel ? corrSel.value : '';
  const positions = corrId ? getConsolidatedPositions(corrId) : getConsolidatedPositions();
  const state = loadAuditState();
  const { rows } = buildCustodyReconciliation({
    positions,
    externalMap: getActiveExternalMap(),
    manualMap: state.manual,
    checkedMap: state.checked
  });

  let marked = 0;
  rows.forEach(r => {
    if (r.isMatch && !state.checked[r.ticker]) {
      state.checked[r.ticker] = true;
      marked++;
    }
  });
  if (marked > 0) {
    state.lastCheckedAt = new Date().toISOString();
    saveAuditState(state);
    renderReconciliationSection();
    if (window.lucide) lucide.createIcons();
    showToast(`${marked} ativo(s) marcados como conferidos.`, 'success');
  } else {
    showToast('Nenhum ativo adicional com quantidade idêntica para marcar.', 'info');
  }
}

export function clearAuditChecklist() {
  saveAuditState({ checked: {}, manual: {}, lastCheckedAt: null });
  renderReconciliationSection();
  if (window.lucide) lucide.createIcons();
  showToast('Marcações de conferência limpas.', 'info');
}
