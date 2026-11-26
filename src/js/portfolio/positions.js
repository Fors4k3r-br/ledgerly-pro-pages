// Consolidação de custódia, snapshot diário, gráficos da carteira, setores na UI, onboarding e cards de posições.

// =========================================================================
// 2. CÁLCULO CONSOLIDADO DE CUSTÓDIA E PREÇO MÉDIO
// =========================================================================
function getConsolidatedPositions(corretoraId = null, asOfISO = null) {
  let ops = corretoraId === 'none'
    ? queryAll(`SELECT * FROM operacoes WHERE corretora_id IS NULL ORDER BY id ASC`)
    : corretoraId
      ? queryAll(`SELECT * FROM operacoes WHERE corretora_id = ? ORDER BY id ASC`, [Number(corretoraId)])
      : queryAll(`SELECT * FROM operacoes ORDER BY id ASC`);
  if (asOfISO) ops = ops.filter(op => { const d = toISODate(op.data_operacao); return d && d <= asOfISO; });

  const quotesRows = queryAll(`SELECT ticker, preco_atual FROM cotacoes_atuais`);
  const allOperations = queryAll('SELECT id, ticker, preco_unitario, data_operacao FROM operacoes');
  const lastPrice = {};
  allOperations.forEach(r => {
    const t = String(r.ticker || '').toUpperCase().trim();
    const k = toISODate(r.data_operacao) + '|' + String(r.id).padStart(9, '0');
    if (!lastPrice[t] || k > lastPrice[t].k) lastPrice[t] = { k, p: Number(r.preco_unitario) };
  });
  const provRows = corretoraId === 'none'
    ? queryAll('SELECT ticker, SUM(valor_liquido) AS total FROM proventos WHERE corretora_id IS NULL GROUP BY ticker')
    : corretoraId
      ? queryAll('SELECT ticker, SUM(valor_liquido) AS total FROM proventos WHERE corretora_id = ? GROUP BY ticker', [Number(corretoraId)])
      : queryAll('SELECT ticker, SUM(valor_liquido) AS total FROM proventos GROUP BY ticker');

  if (typeof globalThis.calculateConsolidatedPositions !== 'function') {
    throw new Error('Módulo de cálculos da carteira não foi carregado.');
  }
  return globalThis.calculateConsolidatedPositions({ ops, quotesRows, lastPrice, provRows, corretoraId });
}

// =========================================================================
// 3. ATUALIZAÇÃO DA INTERFACE (CARTEIRA, GRÁFICO E ABA OCULTA POSIÇÕES)
// =========================================================================
// Registra/atualiza uma fotografia por dia local, após o banco estar pronto.
async function captureDailyPortfolioSnapshot() {
  if (!db || !dailyDb) return;
  const today = isoFromDate(new Date());
  const positions = getConsolidatedPositions();
  const active = positions.filter(p => p.ticker && Number.isFinite(Number(p.qtdAtual)));
  if (!active.length && Number(queryAll('SELECT COUNT(*) AS n FROM operacoes')[0]?.n || 0)===0 && Number(queryAll('SELECT COUNT(*) AS n FROM proventos')[0]?.n || 0)===0) return;
  const totalInvestido = active.reduce((sum,p) => sum + (Number(p.valorInvestido)||0),0);
  const valorMercado = active.reduce((sum,p) => sum + (Number(p.patrimonioAtual)||0),0);
  const proventos = Number(queryAll('SELECT COALESCE(SUM(valor_liquido),0) AS total FROM proventos WHERE data_pagamento <= ?', [today])[0]?.total)||0;

  // A fotografia diária é idempotente: se os totais do dia continuam iguais,
  // não regrava CURRENT_TIMESTAMP, não altera os ativos do snapshot e não
  // provoca persistência/sincronização desnecessária.
  const snapshotAtual = rowsFromDatabase(dailyDb,
    'SELECT total_investido, valor_mercado, proventos_recebidos FROM snapshots_patrimonio WHERE data_referencia = ?',
    [today])[0];
  if (snapshotAtual &&
      Math.abs(Number(snapshotAtual.total_investido || 0) - totalInvestido) < 0.005 &&
      Math.abs(Number(snapshotAtual.valor_mercado || 0) - valorMercado) < 0.005 &&
      Math.abs(Number(snapshotAtual.proventos_recebidos || 0) - proventos) < 0.005) {
    return;
  }

  dailyDb.run('BEGIN TRANSACTION;');
  try {
    dailyDb.run(`INSERT INTO snapshots_patrimonio (data_referencia,total_investido,valor_mercado,resultado,proventos_recebidos) VALUES (?,?,?,?,?) ON CONFLICT(data_referencia) DO UPDATE SET total_investido=excluded.total_investido,valor_mercado=excluded.valor_mercado,resultado=excluded.resultado,proventos_recebidos=excluded.proventos_recebidos,registrado_em=CURRENT_TIMESTAMP`, [today,totalInvestido,valorMercado,valorMercado-totalInvestido,proventos]);
    const snapshotId = Number(rowsFromDatabase(dailyDb,'SELECT id FROM snapshots_patrimonio WHERE data_referencia = ?',[today])[0].id);
    dailyDb.run('DELETE FROM snapshot_patrimonio_ativos WHERE snapshot_id = ?', [snapshotId]);
    active.forEach(p => dailyDb.run(`INSERT INTO snapshot_patrimonio_ativos (snapshot_id,ticker,quantidade,preco_medio,custo_total,cotacao,valor_mercado,resultado) VALUES (?,?,?,?,?,?,?,?)`, [snapshotId,p.ticker,Number(p.qtdAtual)||0,Number(p.precoMedio)||0,Number(p.valorInvestido)||0,Number(p.cotacaoAtual)||0,Number(p.patrimonioAtual)||0,Number(p.lucroPrejuizo)||0]));
    dailyDb.run('COMMIT;'); await persistSQLiteToIndexedDB({ userEdit: false });
  } catch(error) { try { dailyDb.run('ROLLBACK;'); } catch(_) {} console.error('Não foi possível registrar o histórico patrimonial diário:',error); }
}

function refreshAllViews() {
  const positions = getConsolidatedPositions();
  allPositionsData = positions;
  fillCorretoraSelects();
  loadManualClass(); fillSetorSelect(); renderSectorPending(); renderApiStatus();
  const activePositions = positions.filter(p => p.qtdAtual > 0);

  // Soma dos KPIs da Carteira
  const totalInvestido = activePositions.reduce((acc, p) => acc + p.valorInvestido, 0);
  const patrimonioAtual = activePositions.reduce((acc, p) => acc + p.patrimonioAtual, 0);
  const lucroPrejuizo = patrimonioAtual - totalInvestido;
  const rentabilidade = totalInvestido > 0 ? ((lucroPrejuizo / totalInvestido) * 100) : 0;

  const prov12 = Number(queryAll('SELECT COALESCE(SUM(valor_liquido), 0) AS s FROM proventos WHERE data_pagamento >= ?', [todayISO(-365)])[0].s) || 0;
  const provAtivos = activePositions.reduce((acc, p) => acc + (p.proventosRecebidos || 0), 0);
  const rentTotal = totalInvestido > 0 ? (((lucroPrejuizo + provAtivos) / totalInvestido) * 100) : 0;
  const sg = v => (v >= 0 ? '+' : '');
  document.getElementById('kpiPatrimonioAtual').textContent = formatMoney(patrimonioAtual);
  const badge = document.getElementById('kpiResultadoBadge');
  badge.textContent = `${sg(lucroPrejuizo)}${formatMoney(lucroPrejuizo)} (${sg(rentabilidade)}${formatPercent(rentabilidade)})`;
  badge.className = 'px-2.5 py-1 rounded-full text-xs font-bold font-mono ' + (lucroPrejuizo >= 0 ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300');
  document.getElementById('kpiTotalInvestido').textContent = formatMoney(totalInvestido);
  document.getElementById('kpiProventos12m').textContent = formatMoney(prov12);
  const rtEl = document.getElementById('kpiRentabTotal');
  rtEl.textContent = `${sg(rentTotal)}${formatPercent(rentTotal)}`;
  rtEl.className = 'text-sm font-bold font-mono text-right ' + (rentTotal >= 0 ? 'text-emerald-400' : 'text-rose-400');
  lastPortfolio = { patrimonio: patrimonioAtual, investido: totalInvestido };
  renderProfitChart();
  renderOnboarding();
  updateQuotesLabel();
  renderThemeCard();


  renderPortfolioChart(activePositions, patrimonioAtual);
  renderPositionsExpandableCards(positions);
  renderSavedNotesHistory();
  renderProventos();
  if (document.getElementById('tab-relatorios') && !document.getElementById('tab-relatorios').classList.contains('hidden')) renderReports();
  updateDatabaseStats();
  lucide.createIcons();
}

// ===== Gráfico de evolução: Investido x Patrimônio =====
let profitChart = null, lastPortfolio = { patrimonio: 0, investido: 0 };
let chartTooltipHideMs = 4000;   // balões dos gráficos somem sozinhos depois deste tempo
// No toque, o balão do Chart.js ficaria aberto até tocar em outro lugar: este plugin o esconde depois de alguns segundos
function autoHideTooltipPlugin() {
  return { id: 'autoHideTooltip',
    afterEvent(chart, args) {
      const e = args.event; if (!e || e.type === 'mouseout') return;
      clearTimeout(chart.$hideTimer);
      chart.$hideTimer = setTimeout(() => { try { chart.tooltip.setActiveElements([], { x: 0, y: 0 }); chart.setActiveElements([]); chart.update('none'); } catch (_) {} }, chartTooltipHideMs);
    },
    beforeDestroy(chart) { clearTimeout(chart.$hideTimer); } };
}
const PROFIT_RANGES = ['tudo', '1s', '1m', 'mes', '6m', 'sem', '12m', 'ano'];
let profitRange = (() => { try { const r = localStorage.getItem('ledgerly_profit_range'); return PROFIT_RANGES.includes(r) ? r : 'tudo'; } catch (_) { return 'tudo'; } })();
function toISODate(s) {
  s = String(s || '');
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}
function isoFromDate(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function setProfitRange(r) {
  profitRange = PROFIT_RANGES.includes(r) ? r : 'tudo';
  try { localStorage.setItem('ledgerly_profit_range', profitRange); } catch (_) {}
  renderProfitChart();
  const b = document.querySelector(`#rangeChips button[data-r="${profitRange}"]`);
  const box = document.getElementById('rangeChips');   // rola só o carrossel (nunca a página)
  if (b && box && box.scrollTo) box.scrollTo({ left: Math.max(0, b.getBoundingClientRect().left - box.getBoundingClientRect().left + box.scrollLeft - (box.clientWidth - b.offsetWidth) / 2), behavior: 'smooth' });
}
function profitRangeStart(r, firstISO) {
  const t = new Date(), y = t.getFullYear(), m = t.getMonth(), dd = t.getDate();
  const d = { '1s': new Date(y, m, dd - 7), '1m': new Date(y, m - 1, dd), 'mes': new Date(y, m, 1), '6m': new Date(y, m - 6, dd),
    'sem': new Date(y, m < 6 ? 0 : 6, 1), '12m': new Date(y - 1, m, dd), 'ano': new Date(y, 0, 1) }[r];
  const iso = d ? isoFromDate(d) : firstISO;
  return iso > firstISO ? iso : firstISO;   // o gráfico começa na primeira operação
}
// Uma foto por dia: o patrimônio do passado não pode ser reconstruído (o app só conhece o preço de hoje)
// Linha do investido: degraus nas datas das compras. Único ponto de mercado: o patrimônio de hoje (último preço conhecido de cada ativo)
function buildProfitSeries(range) {
  const opDates = Array.from(new Set(queryAll('SELECT data_operacao FROM operacoes').map(r => toISODate(r.data_operacao)).filter(Boolean))).sort();
  if (!opDates.length) return null;
  const today = todayISO(0), start = profitRangeStart(range, opDates[0]);
  const set = new Set([start]);
  opDates.forEach(d => { if (d >= start && d <= today) set.add(d); });
  const dates = Array.from(set).sort(), cache = {};
  const investedAt = d => {
    let key = ''; for (const od of opDates) { if (od <= d) key = od; else break; }
    if (!key) return 0;
    if (!(key in cache)) cache[key] = getConsolidatedPositions(null, key).filter(p => p.qtdAtual > 0).reduce((a, p) => a + p.valorInvestido, 0);
    return cache[key];
  };
  const invested = dates.map(investedAt);
  // "Atual" = patrimônio com a última cotação conhecida; a linha tracejada sai da última data do eixo (a última compra da janela) até ele
  const atual = lastPortfolio.patrimonio > 0 ? { from: invested[invested.length - 1], patr: lastPortfolio.patrimonio } : null;
  return { dates, start, invested, atual };
}
function renderProfitChart() {
  const canvas = document.getElementById('profitChart'); if (!canvas || !db) return;
  document.querySelectorAll('#rangeChips button').forEach(b => {
    const on = b.dataset.r === profitRange;
    b.className = 'shrink-0 whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-semibold border transition ' + (on ? 'bg-emerald-500 border-emerald-500 text-slate-950' : 'border-slate-700 text-slate-300 hover:bg-slate-800');
    b.setAttribute('aria-pressed', String(on));
  });
  if (profitChart) { profitChart.destroy(); profitChart = null; }
  const wrap = document.getElementById('profitChartWrap'), note = document.getElementById('profitChartNote');
  const s = buildProfitSeries(profitRange);
  if (!s || typeof Chart === 'undefined') { if (wrap) wrap.classList.add('hidden'); if (note) note.classList.add('hidden'); return; }
  wrap.classList.remove('hidden');
  const n = s.dates.length, hasAtual = !!s.atual;
  const accent = lastPortfolio.patrimonio >= lastPortfolio.investido ? '16,185,129' : '244,63,94';
  const fmtD = iso => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  const money = v => isPrivacyMode ? 'R$ ••••' : formatMoney(v);
  const iso = getSetting('brapi_last_sync_iso'); let quoteTime = '';
  if (iso) { const d = new Date(iso); if (!isNaN(d)) quoteTime = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
  const labels = s.dates.map(fmtD).concat(hasAtual ? ['Atual'] : []);
  const solid = s.invested.concat(hasAtual ? [null] : []);
  const dashed = hasAtual ? s.dates.map((_, i) => (i === n - 1 ? s.atual.from : null)).concat([s.atual.patr]) : labels.map(() => null);
  // Os balões somem sozinhos depois de alguns segundos (no toque eles ficariam abertos até tocar em outro lugar)
  const autoHide = autoHideTooltipPlugin();
  const lastIdx = labels.length - 1, step = Math.max(1, Math.ceil(lastIdx / 3));
  profitChart = new Chart(canvas.getContext('2d'), {
    type: 'line', plugins: [autoHide],
    data: { labels, datasets: [
      { label: 'Investido', data: solid, borderColor: 'rgb(129,140,248)', borderWidth: 2, stepped: 'after', pointRadius: n <= 3 ? 3 : 0, pointHoverRadius: 4, fill: false },
      { label: 'Patrimônio atual', data: dashed, borderColor: `rgb(${accent})`, backgroundColor: `rgb(${accent})`, borderWidth: 2, borderDash: [6, 4], spanGaps: true, fill: false,
        pointRadius: c => (hasAtual && c.dataIndex === n ? 5 : 0), pointHoverRadius: c => (c.dataIndex === n ? 6 : 0), pointBackgroundColor: `rgb(${accent})`, pointBorderColor: 'rgb(255,255,255)', pointBorderWidth: 1.5 }
    ] },
    options: { responsive: true, maintainAspectRatio: false, layout: { padding: { right: 10, top: 8 } }, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false }, tooltip: {
        filter: it => !(it.datasetIndex === 1 && it.dataIndex !== n),
        callbacks: {
          title: items => (hasAtual && items[0].dataIndex === n ? 'Atual' + (quoteTime ? ' · cotações de ' + quoteTime : '') : items[0].label),
          label: c => (c.parsed.y == null ? null : ` ${c.dataset.label}: ${money(c.parsed.y)}`),
          afterLabel: c => {
            if (!(hasAtual && c.datasetIndex === 1 && c.dataIndex === n) || isPrivacyMode) return '';
            const res = s.atual.patr - s.atual.from, pct = s.atual.from > 0 ? (res / s.atual.from) * 100 : 0;
            return ` Resultado: ${res >= 0 ? '+' : ''}${formatMoney(res)} (${res >= 0 ? '+' : ''}${formatPercent(pct)})`;
          } } } },
      scales: { x: { ticks: { color: themeRgb(400), font: { size: 11 }, autoSkip: false, maxRotation: 0,
          callback(v, i) { return (i === 0 || i === lastIdx || (i % step === 0 && lastIdx - i >= step)) ? this.getLabelForValue(v) : ''; } }, grid: { display: false } },
        y: { display: false, grace: '10%' } } }
  });
}

// ===== CLASSIFICAÇÃO SETORIAL (cadastro da B3 em sectors-data.js + correções do usuário no banco) =====
// O classificador puro foi extraído para src/js/portfolio/sectors.js.
// A leitura do SQLite permanece aqui, junto da camada de persistência.
function loadManualClass() {
  try {
    const rows = queryAll('SELECT codigo, setor, subsetor FROM classificacao_manual');
    globalThis.setManualSectorClass(rows);
  } catch (_) { globalThis.setManualSectorClass([]); }
}
function pendingSectorTickers() {
  const seen = new Set(), out = [];
  allPositionsData.filter(p => p.qtdAtual > 0).forEach(p => { const c = classifyTicker(p.ticker); if (c.origem === 'pendente' && !seen.has(c.code)) { seen.add(c.code); out.push(p.ticker); } });
  return out;
}
function fillSetorSelect() {
  const el = document.getElementById('positionsSetor'); if (!el) return;
  const prev = el.value, esc = escapeSavedNoteText;
  const set = Array.from(new Set(allPositionsData.filter(p => p.qtdAtual > 0).map(p => classifyTicker(p.ticker).setor))).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  el.innerHTML = '<option value="">Todos os setores</option>' + set.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
  if (set.includes(prev)) el.value = prev;
}
function renderSectorPending() {
  const b = document.getElementById('sectorPendingBox'); if (!b) return;
  const list = pendingSectorTickers();
  b.classList.toggle('hidden', !list.length);
  if (list.length) b.textContent = `⚠ ${list.length} ${list.length === 1 ? 'ativo sem classificação' : 'ativos sem classificação'} (${list.slice(0, 4).join(', ')}${list.length > 4 ? '…' : ''}). Toque para classificar.`;
}
function classifyNextPending() { const l = pendingSectorTickers(); if (l.length) openSectorEditor(l[0]); }
function focusSetor(nome) {
  const s = document.getElementById('positionsSetor'), f = document.getElementById('positionsFilter'), c = document.getElementById('positionsCorretora'), q = document.getElementById('positionsSearch');
  if (q) q.value = ''; if (f) f.value = 'active'; if (c) c.value = '';
  if (s) s.value = nome;
  switchTab('posicoes'); applyPositionsView();
}
// Janela para escolher setor e subsetor de um ativo (vale para todas as classes da empresa: PETR3, PETR4…)
function openSectorEditor(ticker) {
  return new Promise(resolve => {
    const c = classifyTicker(ticker), esc = escapeSavedNoteText;
    const ov = document.createElement('div');
    ov.className = 'fixed inset-0 z-[200] bg-black/70 flex items-center justify-center p-4';
    ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
    const box = document.createElement('div');
    box.className = 'glass-card w-full max-w-sm max-h-[85vh] overflow-y-auto rounded-2xl p-5 space-y-3 border border-slate-700';
    const cls = 'w-full bg-slate-900 border border-slate-700 focus:border-emerald-500 rounded-xl px-3.5 py-2.5 text-sm text-white outline-none';
    const origem = { manual: 'sua correção', b3: 'cadastro da B3', auto: 'regra automática', pendente: 'sem classificação' }[c.origem];
    box.innerHTML = `<h3 class="text-base font-bold text-white">Classificar ${esc(ticker)}</h3>
      <p class="text-xs text-slate-300">Vale para todas as classes de <strong>${esc(c.code)}</strong> (${esc(c.code)}3, ${esc(c.code)}4, ${esc(c.code)}11…). Origem atual: ${origem}.</p>
      <label class="block text-[11px] font-semibold text-slate-300" for="sectorEditSetor">Setor</label><select id="sectorEditSetor" class="${cls}"></select>
      <div id="sectorEditSubWrap"><label class="block text-[11px] font-semibold text-slate-300 mb-1.5" for="sectorEditSub">Subsetor</label><select id="sectorEditSub" class="${cls}"></select></div>
      <p id="sectorEditErr" class="hidden text-xs text-rose-300"></p><div id="sectorEditBtns" class="flex flex-col gap-2 pt-1"></div>`;
    ov.appendChild(box); document.body.appendChild(ov);
    const selS = box.querySelector('#sectorEditSetor'), selB = box.querySelector('#sectorEditSub'), wrap = box.querySelector('#sectorEditSubWrap'), err = box.querySelector('#sectorEditErr');
    const opt = (v, t, sel) => `<option value="${esc(v)}"${sel ? ' selected' : ''}>${esc(t)}</option>`;
    selS.innerHTML = opt('', 'Escolha o setor…', false) + setorOptions().map(s => opt(s, s, s === c.setor)).join('');
    const fillSub = pre => { const l = subsetoresDe(selS.value); wrap.classList.toggle('hidden', !l.length); selB.innerHTML = opt('', 'Escolha o subsetor…', false) + l.map(s => opt(s, s, s === pre)).join(''); };
    fillSub(c.subsetor); selS.addEventListener('change', () => fillSub(''));
    const done = v => { ov.remove(); resolve(v); };
    const mk = (label, primary, fn) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label;
      b.className = 'w-full px-4 py-2.5 rounded-xl text-xs font-bold ' + (primary ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950' : 'bg-slate-800 hover:bg-slate-700 text-slate-200');
      b.onclick = fn; box.querySelector('#sectorEditBtns').appendChild(b); };
    mk('Salvar', true, async () => {
      const setor = selS.value; const subs = subsetoresDe(setor), sub = subs.length ? selB.value : '';
      if (!setor || (subs.length && !sub)) { err.textContent = !setor ? 'Escolha o setor.' : 'Escolha o subsetor.'; err.classList.remove('hidden'); return; }
      db.run('INSERT OR REPLACE INTO classificacao_manual (codigo, setor, subsetor, atualizado_em) VALUES (?, ?, ?, ?)', [c.code, setor, sub, new Date().toISOString()]);
      loadManualClass(); done('saved'); refreshAllViews(); showToast(`${c.code} classificado em ${setor}.`, 'success');
      persistSQLiteToIndexedDB().catch(e => console.error('Falha ao gravar a classificação:', e));
    });
    if (c.origem === 'manual') mk('Restaurar padrão', false, async () => {
      db.run('DELETE FROM classificacao_manual WHERE codigo = ?', [c.code]);
      loadManualClass(); done('restored'); refreshAllViews(); showToast(`${c.code} voltou à classificação padrão.`, 'info');
      persistSQLiteToIndexedDB().catch(e => console.error('Falha ao gravar a classificação:', e));
    });
    mk('Cancelar', false, () => done('cancel'));
  });
}
// ===== FIM DA CLASSIFICAÇÃO SETORIAL =====

let chartMode = (() => { try { const v = localStorage.getItem('ledgerly_chart_mode'); return v === 'corretora' || v === 'setor' ? v : 'ativo'; } catch (_) { return 'ativo'; } })();
function setChartMode(m) { chartMode = (m === 'corretora' || m === 'setor') ? m : 'ativo'; try { localStorage.setItem('ledgerly_chart_mode', chartMode); } catch (_) {} refreshAllViews(); }
function focusTicker(t) {
  const s = document.getElementById('positionsSearch'), f = document.getElementById('positionsFilter'), c = document.getElementById('positionsCorretora');
  if (s) s.value = t; if (f) f.value = 'active'; if (c) c.value = '';
  switchTab('posicoes');
  setTimeout(() => { const d = document.getElementById('pos-details-0'); if (d && !document.getElementById('pos-details-1') && d.classList.contains('hidden')) togglePositionCard(0); }, 60);
}
function focusCorretora(id) {
  const s = document.getElementById('positionsSearch'), f = document.getElementById('positionsFilter'), c = document.getElementById('positionsCorretora');
  if (s) s.value = ''; if (f) f.value = 'active'; if (c) c.value = String(id);
  switchTab('posicoes');
}
let outrosAtivos = [], outrosTotal = 0;
function showOutrosAtivos() {
  const lines = outrosAtivos.slice().sort((a, b) => b.value - a.value).map(o => `• ${o.ticker} — ${(outrosTotal > 0 ? (o.value / outrosTotal) * 100 : 0).toFixed(1)}%`);
  ledgerlyModal({ title: `Outros (${outrosAtivos.length} ativos)`, message: 'Ativos menores agrupados na rosca:\n' + lines.join('\n'), buttons: [{ label: 'Fechar', value: 'ok', primary: true }] });
}
function renderPortfolioChart(activePositions, totalPatrimonio) {
  const emptyState = document.getElementById('emptyChartState');
  const chartWrapper = document.getElementById('chartWrapper');
  const legendList = document.getElementById('chartLegendList');
  document.querySelectorAll('#chartModeChips button').forEach(b => {
    const on = b.dataset.m === chartMode;
    b.className = 'px-3 py-1.5 rounded-full text-xs font-semibold transition ' + (on ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-300 hover:bg-slate-700');
    b.setAttribute('aria-pressed', String(on));
  });
  const sub = document.getElementById('chartSubtitle');
  if (sub) sub.textContent = chartMode === 'corretora' ? 'Patrimônio por corretora' : chartMode === 'setor' ? 'Patrimônio por setor' : 'Por valor em custódia';

  if (activePositions.length === 0) {
    emptyState.classList.remove('hidden');
    chartWrapper.classList.add('hidden');
    legendList.innerHTML = '';
    if (portfolioChart) { portfolioChart.destroy(); portfolioChart = null; }
    return;
  }
  emptyState.classList.add('hidden');
  chartWrapper.classList.remove('hidden');

  const palette = ['#10b981', '#6366f1', '#f59e0b', '#06b6d4', '#ec4899', '#8b5cf6', '#14b8a6', '#f97316'];
  let slices = [];
  if (chartMode === 'setor') {
    const by = {};
    activePositions.forEach(p => { const s = classifyTicker(p.ticker).setor; by[s] = (by[s] || 0) + p.patrimonioAtual; });
    slices = Object.entries(by).map(([label, value]) => ({ label, value, action: `focusSetor('${label}')` })).sort((a, b) => b.value - a.value);
  } else if (chartMode === 'corretora') {
    const shortName = n => n.replace(/\s+(S\.?\/?A\.?|LTDA\.?|CCTVM|DTVM|CTVM)\b.*$/i, '').trim() || n;
    queryAll('SELECT id, nome FROM corretoras ORDER BY nome').forEach(c => {
      const v = getConsolidatedPositions(c.id).filter(p => p.qtdAtual > 0).reduce((a, p) => a + p.patrimonioAtual, 0);
      if (v > 0) slices.push({ label: shortName(c.nome), value: v, action: `focusCorretora(${Number(c.id)})` });
    });
    const semCorr = getConsolidatedPositions('none').filter(p => p.qtdAtual > 0).reduce((a, p) => a + p.patrimonioAtual, 0);
    if (semCorr > 0.005) slices.push({ label: 'Sem corretora', value: semCorr, action: "focusCorretora('none')" });
    slices.sort((a, b) => b.value - a.value);
  } else {
    const sorted = activePositions.slice().sort((a, b) => b.patrimonioAtual - a.patrimonioAtual);
    // Até 8 ativos aparecem sozinhos; só acima disso os menores são agrupados em "Outros" (que abre a lista)
    const head = sorted.length > 8 ? sorted.slice(0, 7) : sorted, rest = sorted.length > 8 ? sorted.slice(7) : [];
    head.forEach(p => slices.push({ label: p.ticker, value: p.patrimonioAtual, action: `focusTicker('${p.ticker}')` }));
    outrosAtivos = rest.map(p => ({ ticker: p.ticker, value: p.patrimonioAtual }));
    if (rest.length) slices.push({ label: `Outros (${rest.length})`, value: rest.reduce((a, p) => a + p.patrimonioAtual, 0), action: 'showOutrosAtivos()', grey: true });
  }
  const colorOf = (s, idx) => ((s.grey || !s.action) ? '#64748b' : palette[idx % palette.length]);
  const denom = slices.reduce((a, s) => a + s.value, 0) || totalPatrimonio;   // as fatias sempre somam 100%
  outrosTotal = denom;

  const ctx = document.getElementById('portfolioDonutChart').getContext('2d');
  if (portfolioChart) portfolioChart.destroy();
  portfolioChart = new Chart(ctx, {
    type: 'doughnut', plugins: [autoHideTooltipPlugin()],
    data: { labels: slices.map(s => s.label), datasets: [{ data: slices.map(s => Number(s.value.toFixed(2))), backgroundColor: slices.map(colorOf), borderColor: themeRgb(925), borderWidth: 3, hoverOffset: 6 }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '68%',
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: function(context) {
        const val = context.parsed || 0;
        const pct = denom > 0 ? ((val / denom) * 100).toFixed(1) : 0;
        return ` ${context.label}: ${isPrivacyMode ? 'R$ ••••' : formatMoney(val)} (${pct}%)`;
      } } } }
    }
  });

  legendList.innerHTML = slices.map((s, idx) => {
    const pct = denom > 0 ? ((s.value / denom) * 100) : 0;
    return `
      <button type="button" ${s.action ? `onclick="${s.action}"` : 'disabled'} class="flex items-center justify-between p-2.5 rounded-xl bg-slate-900/90 border border-slate-800/90 text-xs text-left transition ${s.action ? 'hover:border-emerald-500/50' : 'cursor-default'}">
        <div class="flex items-center gap-2 truncate">
          <span class="w-3 h-3 rounded-full shrink-0" style="background-color: ${colorOf(s, idx)}"></span>
          <strong class="font-mono text-white truncate">${escapeSavedNoteText(s.label)}</strong>
        </div>
        <span class="font-mono text-slate-300">${pct.toFixed(1)}%</span>
      </button>`;
  }).join('');
}

// Primeiro uso: prioriza recuperação de um backup antes das configurações opcionais.
function renderOnboarding() {
  const card = document.getElementById('onboardingCard'), home = document.getElementById('homeContent');
  if (!card || !home) return;
  const empty = isLocalEmpty();
  card.classList.toggle('hidden', !empty); home.classList.toggle('hidden', empty);
  if (!empty) return;
  const steps = [
    ['file-up', 'Começar uma nova carteira', 'Importe sua primeira nota de corretagem em PDF', 'adicionar', false],
    ['cloud', 'Conectar o Google Drive', 'Backup e sincronização entre aparelhos', 'sync', Boolean(syncState().connected)],
    ['shield-check', 'Definir um PIN de acesso', 'Proteja o app com PIN ou biometria', 'seguranca', Boolean(getSetting('security_pin_hash'))]
  ];
  card.innerHTML = `
    <div><h2 class="text-lg font-extrabold text-white">Bem-vindo ao Ledgerly Pro</h2><p class="text-xs text-slate-400 mt-0.5">Você pode restaurar uma carteira existente ou começar uma nova.</p></div>
    <button type="button" onclick="requestRestoreDatabase()" class="w-full flex items-center gap-3 p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/40 hover:border-emerald-400 text-left transition">
      <span class="w-11 h-11 rounded-xl bg-emerald-500/15 flex items-center justify-center text-emerald-400 shrink-0"><i data-lucide="cloud-download" class="w-6 h-6"></i></span>
      <span class="min-w-0 flex-1"><strong class="block text-sm text-white">Restaurar banco de dados</strong><span class="block text-xs text-slate-300">Recupere sua carteira e seu histórico de um arquivo local ou do Google Drive</span></span>
      <i data-lucide="chevron-right" class="w-5 h-5 text-emerald-300 shrink-0"></i>
    </button>
    <div class="pt-1"><p class="text-[11px] text-slate-500 uppercase tracking-wider font-bold mb-2">Ou configure uma nova carteira</p><div class="space-y-2">${steps.map(([icon, title, desc, tab, done]) => `
      <button type="button" onclick="switchTab('${tab}')" class="w-full flex items-center gap-3 p-3.5 rounded-2xl bg-slate-900 border ${done ? 'border-emerald-500/40' : 'border-slate-800'} hover:border-emerald-500/50 text-left transition">
        <span class="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center text-slate-300 shrink-0"><i data-lucide="${icon}" class="w-5 h-5"></i></span>
        <span class="min-w-0 flex-1"><strong class="block text-sm text-white">${title}</strong><span class="block text-xs text-slate-400">${desc}</span></span>
        <i data-lucide="${done ? 'check-circle-2' : 'chevron-right'}" class="w-5 h-5 ${done ? 'text-emerald-400' : 'text-slate-400'} shrink-0"></i>
      </button>`).join('')}</div></div>`;
  lucide.createIcons();
}

// Etiqueta compacta das cotações ("atualizadas há 2 h")
function relTime(iso) {
  const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  if (min < 1440) return `há ${Math.round(min / 60)} h`;
  return `há ${Math.round(min / 1440)} d`;
}
function updateQuotesLabel() {
  const el = document.getElementById('brapiLastSyncLabel'); if (!el || !db) return;
  const iso = getSetting('brapi_last_sync_iso'), old = getSetting('brapi_last_sync');
  if (iso) {
    const d = new Date(iso), n = new Date();
    const hm = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const diff = Math.round((new Date(n.getFullYear(), n.getMonth(), n.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
    const dia = diff === 0 ? 'hoje' : diff === 1 ? 'ontem' : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    el.textContent = `Cotações atualizadas ${dia} às ${hm}`;
  } else el.textContent = old ? `Cotações: última atualização ${old}` : 'Cotações ainda não atualizadas';
}
let lastQuoteTap = 0;
function onQuotesBlockTap() {
  const wait = 30000 - (Date.now() - lastQuoteTap);
  if (wait > 0) { showToast(`Aguarde ${Math.ceil(wait / 1000)} s para atualizar de novo.`, 'info'); return; }
  lastQuoteTap = Date.now();
  syncAllQuotesFromBrapi();
}
setInterval(() => { try { updateQuotesLabel(); } catch (_) {} }, 60000);

// Renderiza os Retângulos Expansíveis na Aba Oculta "Posições"
let latestPositionsData = [];
let allPositionsData = [];

function renderPositionsExpandableCards(positions) {
  const corrSel = document.getElementById('positionsCorretora');
  const corrId = corrSel ? corrSel.value : '';
  latestPositionsData = corrId ? getConsolidatedPositions(corrId) : (positions || getConsolidatedPositions());
  const corrNote = document.getElementById('positionsCorretoraNote');
  if (corrNote) {
    const semCorr = corrId ? Number(queryAll('SELECT COUNT(*) AS n FROM proventos WHERE corretora_id IS NULL')[0].n) : 0;
    corrNote.classList.toggle('hidden', !semCorr);
  }
  const active = latestPositionsData.filter(p => p.qtdAtual > 0);
  const totalInvestido = active.reduce((a,p) => a + p.valorInvestido, 0);
  const totalAtual = active.reduce((a,p) => a + p.patrimonioAtual, 0);
  const totalAberto = active.reduce((a,p) => a + p.lucroPrejuizo, 0);
  const totalRealizado = latestPositionsData.reduce((a,p) => a + (p.resultadoRealizado || 0), 0);
  latestPositionsData.forEach(p => p.pesoCarteira = totalAtual > 0 ? (p.patrimonioAtual / totalAtual) * 100 : 0);

  const resTotal = totalAberto + totalRealizado + latestPositionsData.reduce((a,p) => a + (p.proventosRecebidos || 0), 0);
  const overview = document.getElementById('positionsOverview');
  if (overview) overview.innerHTML = [
    ['Patrimônio atual', formatMoney(totalAtual), 'text-white'],
    ['Resultado total', (resTotal >= 0 ? '+' : '') + formatMoney(resTotal), resTotal >= 0 ? 'text-emerald-400' : 'text-rose-400']
  ].map(([label,value,color]) => `<div class="glass-card rounded-xl p-3 min-w-0"><span class="block text-[11px] text-slate-400">${label}</span><strong class="block mt-1 text-sm font-mono ${color} break-words">${value}</strong></div>`).join('');

  const allocation = document.getElementById('positionsAllocation');
  if (allocation) {
    const top = active.slice().sort((a,b) => b.patrimonioAtual-a.patrimonioAtual).slice(0,5);
    const colors = ['#10b981','#6366f1','#f59e0b','#06b6d4','#ec4899'];
    allocation.innerHTML = active.length ? `
      <div class="flex items-center justify-between"><strong class="text-xs text-slate-200">Distribuição da carteira</strong><span class="text-[11px] text-slate-500">Por valor de mercado</span></div>
      <div class="flex h-2.5 overflow-hidden rounded-full bg-slate-800">${top.map((p,i)=>`<span style="width:${p.pesoCarteira}%;background:${colors[i%colors.length]}"></span>`).join('')}${active.length>5?`<span style="width:${Math.max(0,100-top.reduce((a,p)=>a+p.pesoCarteira,0))}%;background:#64748b"></span>`:''}</div>
      <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">${top.map((p,i)=>`<div class="flex items-center gap-2 text-[11px] min-w-0"><span class="w-2 h-2 rounded-full shrink-0" style="background:${colors[i%colors.length]}"></span><span class="text-slate-300 font-mono">${p.ticker}</span><strong class="ml-auto text-slate-200">${p.pesoCarteira.toFixed(1)}%</strong></div>`).join('')}</div>
      ${active.length>5?'<p class="text-[11px] text-slate-500">Exibindo os cinco maiores ativos; os demais estão agrupados no saldo.</p>':''}` : '<p class="text-xs text-slate-500">A distribuição aparecerá quando houver posições abertas.</p>';
  }
  applyPositionsView();
}

function applyPositionsView() {
  const container = document.getElementById('positionsCardsContainer');
  if (!container) return;
  const search = (document.getElementById('positionsSearch')?.value || '').trim().toUpperCase();
  const filter = document.getElementById('positionsFilter')?.value || 'active';
  const sort = document.getElementById('positionsSort')?.value || 'ticker';
  const setorF = document.getElementById('positionsSetor')?.value || '';
  let list = latestPositionsData.filter(p => {
    const match = !search || p.ticker.toUpperCase().includes(search) || (p.especificacao || '').toUpperCase().includes(search);
    if (!match) return false;
    if (setorF && classifyTicker(p.ticker).setor !== setorF) return false;
    if (filter === 'active') return p.qtdAtual > 0;
    if (filter === 'positive') return p.qtdAtual > 0 && p.lucroPrejuizo > 0;
    if (filter === 'negative') return p.qtdAtual > 0 && p.lucroPrejuizo < 0;
    if (filter === 'closed') return p.qtdAtual <= 0;
    return true;
  });
  list.sort((a,b) => sort === 'value' ? b.patrimonioAtual-a.patrimonioAtual : sort === 'profit' ? b.lucroPrejuizo-a.lucroPrejuizo : sort === 'return' ? b.rentabilidade-a.rentabilidade : sort === 'weight' ? b.pesoCarteira-a.pesoCarteira : a.ticker.localeCompare(b.ticker));
  const count = document.getElementById('positionsResultCount');
  if (count) count.textContent = `${list.length} de ${latestPositionsData.length} ativos`;
  const info = document.getElementById('positionsFilterInfo');
  if (info) info.classList.toggle('hidden', !(search || filter !== 'active' || setorF));
  document.querySelectorAll('#positionsChips button').forEach(b => {
    const on = b.dataset.f === filter;
    b.className = 'px-3 py-1.5 rounded-full text-xs font-semibold transition ' + (on ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-300 hover:bg-slate-700');
    b.setAttribute('aria-pressed', String(on));
  });
  const closedCount = latestPositionsData.filter(p => p.qtdAtual <= 0).length;
  const closedLink = (filter === 'active' && closedCount) ? `<button type="button" onclick="setPositionsFilter('closed')" class="w-full text-center text-xs text-slate-400 hover:text-slate-200 py-2">Mostrar ${closedCount} ${closedCount === 1 ? 'posição encerrada' : 'posições encerradas'}</button>` : '';
  if (!latestPositionsData.length) {
    container.innerHTML = `<div class="glass-card rounded-2xl p-8 text-center space-y-2"><p class="text-sm font-semibold text-slate-300">Nenhum ativo registrado ainda</p><p class="text-xs text-slate-500">Importe uma nota de corretagem ou adicione uma operação manual.</p></div>`;
    return;
  }
  if (!list.length) {
    container.innerHTML = `<div class="glass-card rounded-2xl p-6 text-center"><p class="text-xs text-slate-400">Nenhum ativo corresponde à pesquisa ou aos filtros.</p></div>${closedLink}`;
    return;
  }
  container.innerHTML = list.map((pos, idx) => {
    const esc = escapeSavedNoteText;
    const hasPosition = pos.qtdAtual > 0;
    const res = hasPosition ? pos.lucroPrejuizo : (pos.resultadoRealizado || 0);
    const sgn = v => (v >= 0 ? '+' : '');
    const tone = v => (v >= 0 ? 'text-emerald-400' : 'text-rose-400');
    const badgeTone = res >= 0 ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300';
    const badgeText = `${sgn(res)}${formatMoney(res)}${hasPosition ? ` (${sgn(pos.rentabilidade)}${formatPercent(pos.rentabilidade)})` : ' realizado'}`;
    const kv = (l, v, c = 'text-slate-200') => `<div class="flex items-baseline justify-between gap-3 py-1.5"><dt class="text-xs text-slate-400">${l}</dt><dd class="text-xs font-mono text-right ${c}">${v}</dd></div>`;
    const sec = (t, body) => `<section><h5 class="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-0.5">${t}</h5><dl class="divide-y divide-slate-800/70">${body}</dl></section>`;
    const opRow = op => `<div class="flex items-center justify-between gap-2 py-2 text-xs"><div class="flex items-center gap-2 min-w-0"><span class="px-1.5 py-0.5 rounded text-[11px] font-semibold ${op.tipo_ordem === 'C' ? 'bg-slate-800 text-slate-200' : 'bg-amber-500/20 text-amber-300'}">${op.tipo_ordem === 'C' ? 'Compra' : 'Venda'}</span><span class="font-mono text-slate-400" title="Nota: ${esc(op.numero_nota || 'Manual')}">${esc(op.data_operacao)}</span></div><div class="flex items-center gap-1.5"><span class="font-mono text-slate-200">${formatNumber(op.quantidade)} × ${formatMoney(op.preco_unitario)}</span><button type="button" onclick="deleteSingleOperation(${Number(op.id)})" class="text-rose-400 hover:text-rose-300 p-1.5" aria-label="Excluir lançamento de ${esc(op.data_operacao)}" title="Excluir lançamento"><i data-lucide="trash-2" class="w-4 h-4"></i></button></div></div>`;
    const ops = pos.operacoes.slice().reverse();
    const cl = classifyTicker(pos.ticker);
    const setorBtn = `<button type="button" onclick="openSectorEditor('${esc(pos.ticker)}')" class="text-right underline decoration-dotted underline-offset-2 hover:text-emerald-300" aria-label="Alterar setor de ${esc(pos.ticker)}">${esc(cl.setor)}${cl.subsetor ? ' · ' + esc(cl.subsetor) : ''}${cl.origem === 'manual' ? ' (manual)' : cl.origem === 'pendente' ? ' — classificar' : ''}</button>`;
    const posicao = sec('Posição',
      kv('Custo da posição', formatMoney(pos.valorInvestido)) +
      kv('Comprado / vendido', `${formatNumber(pos.qtdComprada)} / ${formatNumber(pos.qtdVendida)}`) +
      kv('Participação na carteira', `${pos.pesoCarteira.toFixed(2)}%`) +
      kv('Setor', setorBtn));
    const resultado = sec('Resultado',
      (hasPosition ? kv('Não realizado', `${sgn(pos.lucroPrejuizo)}${formatMoney(pos.lucroPrejuizo)} (${formatPercent(pos.rentabilidade)})`, tone(pos.lucroPrejuizo)) : '') +
      kv('Realizado', `${sgn(pos.resultadoRealizado || 0)}${formatMoney(pos.resultadoRealizado || 0)}`, tone(pos.resultadoRealizado || 0)) +
      kv('Proventos (líquido)', formatMoney(pos.proventosRecebidos || 0)) +
      (pos.valorInvestido > 0 ? kv('Rentabilidade total (c/ proventos)', formatPercent(pos.rentabilidadeTotal || 0), tone(pos.rentabilidadeTotal || 0)) : ''));
    const custos = `<details class="rounded-xl bg-slate-900/60 px-3 py-2"><summary class="flex items-center justify-between cursor-pointer list-none [&::-webkit-details-marker]:hidden text-xs"><span class="text-slate-400">Taxas e custos</span><span class="font-mono text-slate-200">${formatMoney(pos.totalTaxas)} ▾</span></summary><dl class="divide-y divide-slate-800/70 mt-1">${kv('CBLC', formatMoney(pos.totalTaxasCblc))}${kv('Bovespa / emolumentos', formatMoney(pos.totalTaxasBovespa))}${kv('Corretagem / despesas', formatMoney(pos.totalTaxasCorretagem))}</dl></details>`;
    const cotacao = hasPosition ? `<details class="rounded-xl bg-slate-900/60 px-3 py-2"><summary class="flex items-center justify-between cursor-pointer list-none [&::-webkit-details-marker]:hidden text-xs"><span class="text-slate-400">Cotação atual</span><span class="font-mono text-slate-200">${formatMoney(pos.cotacaoAtual)} · Ajustar ▾</span></summary><div class="flex items-center gap-1.5 pt-2"><input type="number" step="any" id="quote-input-${pos.ticker}" value="${pos.cotacaoAtual}" aria-label="Cotação de ${esc(pos.ticker)}" class="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded-xl px-2.5 py-2 text-xs font-mono text-white"/><button type="button" onclick="openCalculator('quote-input-${pos.ticker}', 'Cotação Atual ${pos.ticker}')" class="p-2 rounded-xl bg-indigo-500/20 text-indigo-300 border border-indigo-500/30" aria-label="Calcular cotação" title="Calcular cotação"><i data-lucide="calculator" class="w-4 h-4"></i></button><button type="button" onclick="updateTickerQuote('${pos.ticker}')" class="px-3 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs">Atualizar</button></div></details>` : '';
    const historico = `<section><h5 class="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-0.5">Operações (${ops.length})</h5><div class="divide-y divide-slate-800/70">${ops.slice(0, 5).map(opRow).join('')}</div>${ops.length > 5 ? `<details class="mt-1"><summary class="text-xs text-indigo-300 cursor-pointer py-1.5">Ver todas as ${ops.length} operações</summary><div class="divide-y divide-slate-800/70 max-h-64 overflow-y-auto">${ops.slice(5).map(opRow).join('')}</div></details>` : ''}</section>`;
    return `
      <div class="glass-card rounded-2xl overflow-hidden border border-slate-800">
        <button type="button" id="pos-head-${idx}" aria-expanded="false" aria-controls="pos-details-${idx}" onclick="togglePositionCard(${idx})" class="w-full text-left p-4 hover:bg-slate-800/40 transition space-y-2">
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0"><span class="font-mono font-extrabold text-base text-white">${esc(pos.ticker)}</span><span class="block text-xs text-slate-400 truncate">${esc(pos.especificacao || '')}</span></div>
            <div class="flex items-center gap-2 shrink-0"><strong class="text-base font-mono text-white">${hasPosition ? formatMoney(pos.patrimonioAtual) : '—'}</strong><i data-lucide="chevron-down" id="pos-chevron-${idx}" class="w-4 h-4 text-slate-400 transition"></i></div>
          </div>
          <div class="flex items-center justify-between gap-3">
            <span class="text-xs font-mono text-slate-400 truncate">${hasPosition ? `${formatNumber(pos.qtdAtual)} × ${formatMoney(pos.precoMedio)} · ${pos.pesoCarteira.toFixed(1)}%` : 'Posição encerrada'}</span>
            <span class="shrink-0 px-2.5 py-1 rounded-full text-xs font-bold font-mono ${badgeTone}">${badgeText}</span>
          </div>
        </button>
        <div id="pos-details-${idx}" class="hidden bg-slate-950/80 border-t border-slate-800 p-4 space-y-4">
          ${posicao}${resultado}${custos}${cotacao}${historico}
        </div>
      </div>`;
  }).join('') + closedLink;
  lucide.createIcons();
}

function clearPositionsFilters() {
  const search = document.getElementById('positionsSearch');
  const filter = document.getElementById('positionsFilter');
  const sort = document.getElementById('positionsSort');
  if (search) search.value = '';
  if (filter) filter.value = 'active';
  const setorSel = document.getElementById('positionsSetor'); if (setorSel) setorSel.value = '';
  if (sort) sort.value = 'ticker';
  applyPositionsView();
}

function setPositionsFilter(value) {
  const f = document.getElementById('positionsFilter');
  if (f) f.value = value;
  applyPositionsView();
}
function togglePositionCard(idx) {
  const details = document.getElementById(`pos-details-${idx}`);
  const chevron = document.getElementById(`pos-chevron-${idx}`);
  if (!details) return;
  const isHidden = details.classList.contains('hidden');
  const head = document.getElementById(`pos-head-${idx}`);
  if (head) head.setAttribute('aria-expanded', String(isHidden));
  if (isHidden) {
    details.classList.remove('hidden');
    if (chevron) chevron.style.transform = 'rotate(180deg)';
  } else {
    details.classList.add('hidden');
    if (chevron) chevron.style.transform = 'rotate(0deg)';
  }
}

async function updateTickerQuote(ticker) {
  const input = document.getElementById(`quote-input-${ticker}`);
  if (!input) return;
  const val = parseFloat(input.value);
  if (isNaN(val) || val < 0) {
    showToast('Informe uma cotação válida.', 'error');
    return;
  }
  db.run('INSERT OR REPLACE INTO cotacoes_atuais (ticker, preco_atual) VALUES (?, ?)', [ticker, val]);
  await persistSQLiteToIndexedDB();
  refreshAllViews();
  showToast(`Cotação de ${ticker} atualizada!`, 'success');
}

async function deleteSingleOperation(opId) {
  db.run('DELETE FROM operacoes WHERE id = ?', [opId]);
  await persistSQLiteToIndexedDB();
  refreshAllViews();
  showToast('Operação removida.', 'info');
}
