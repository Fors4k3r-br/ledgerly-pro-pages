// Importação de notas de corretagem em PDF, tela de revisão (staging), histórico paginado e inserção manual.

import { extractTextFromPDFBuffer, renderPdfPages } from './pdf-reader.js';
import { parseSinacorNote } from './note-parser.js';
import { db, stagedNotesQueue, setStagedNotesQueue } from '../core/state.js';
import { ensureCorretora, onManCorretoraChange, persistSQLiteToIndexedDB, queryAll } from '../core/database.js';
import { refreshAllViews } from '../portfolio/positions.js';
import { arrayBufferToBase64, formatMoney, formatNumber, showToast, switchTab } from '../ui/navigation.js';

export function setTodayDateOnManualForm() {
  const hoje = new Date();
  const dd = String(hoje.getDate()).padStart(2, '0');
  const mm = String(hoje.getMonth() + 1).padStart(2, '0');
  const yyyy = hoje.getFullYear();
  document.getElementById('manData').value = `${dd}/${mm}/${yyyy}`;
}

// =========================================================================
// 4. IMPORTAÇÃO DE NOTAS DE CORRETAGEM (PDF SINACOR + ANTI-DUPLICIDADE)
// =========================================================================
async function handlePdfSelection(event, mode) {
  const files = Array.from(event.target.files || []).filter(f => f.name.toLowerCase().endsWith('.pdf'));
  event.target.value = ''; // limpa o seletor para permitir reimportação

  if (files.length === 0) {
    showToast('Nenhum arquivo PDF encontrado na seleção.', 'error');
    return;
  }

  const skippedDuplicates = [];
  const newlyParsedNotes = [];

  for (const file of files) {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const base64Pdf = arrayBufferToBase64(arrayBuffer);
      const extractedText = await extractTextFromPDFBuffer(arrayBuffer);
      const parsedNote = parseSinacorNote(extractedText, file.name, base64Pdf);

      // Verifica no SQLite se o numero_controle já foi importado antes
      if (isNoteAlreadyInSQLite(parsedNote.numero_controle)) {
        skippedDuplicates.push(`${parsedNote.numero_controle} (${file.name})`);
        continue;
      }

      // Evita duplicidade dentro do próprio lote atual
      const alreadyInStaging = stagedNotesQueue.some(n => n.numero_controle === parsedNote.numero_controle) ||
                               newlyParsedNotes.some(n => n.numero_controle === parsedNote.numero_controle);
      if (alreadyInStaging) {
        skippedDuplicates.push(`${parsedNote.numero_controle} (Duplicado na pasta)`);
        continue;
      }

      newlyParsedNotes.push(parsedNote);
    } catch (err) {
      console.error('Erro ao ler PDF:', file.name, err);
      showToast((err && err.userMessage) || `Falha ao processar ${file.name}`, 'error');
    }
  }

  // Exibe alerta se alguma nota foi barrada por já constar no banco
  if (skippedDuplicates.length > 0) {
    const alertBox = document.getElementById('duplicateNotesAlert');
    const listEl = document.getElementById('duplicateNotesList');
    listEl.innerHTML = skippedDuplicates.map(item => `<li>Nota <strong>${item}</strong> ignorada (já consta no banco de dados).</li>`).join('');
    alertBox.classList.remove('hidden');
    showToast(`${skippedDuplicates.length} nota(s) já existente(s) ignorada(s).`, 'info');
  }

  if (newlyParsedNotes.length > 0) {
    stagedNotesQueue.push(...newlyParsedNotes);
    renderStagingScreen();
    showToast(`${newlyParsedNotes.length} nota(s) carregada(s) para conferência!`, 'success');
  }
}

function isNoteAlreadyInSQLite(numeroControle) {
  const existing = queryAll('SELECT id FROM notas_corretagem WHERE numero_controle = ?', [numeroControle.trim()]);
  return existing.length > 0;
}

// =========================================================================
// 5. TELA DE REVISÃO (STAGING), HISTÓRICO DE NOTAS E INSERÇÃO MANUAL
// =========================================================================
export function renderStagingScreen() {
  const container = document.getElementById('stagingContainer');
  const list = document.getElementById('stagingItemsList');
  if (!container || !list) return;

  if (stagedNotesQueue.length === 0) {
    container.classList.add('hidden');
    list.innerHTML = '';
    return;
  }

  container.classList.remove('hidden');

  list.innerHTML = stagedNotesQueue.map((note, nIdx) => `
    <div class="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 space-y-3">
      <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
        <div class="min-w-0 space-y-1.5">
          <div class="flex flex-wrap items-center gap-2">
            <span class="px-2.5 py-1 rounded-lg bg-indigo-500/20 text-indigo-300 font-mono text-xs font-bold">
              Nr. Nota: ${note.numero_controle}
            </span>
            <span class="text-xs font-mono text-slate-300">Pregão: ${note.data_pregao}</span>
          </div>
          <p class="text-xs text-slate-400 break-words">${escapeSavedNoteText(note.corretora_nome || 'Corretora não identificada')}</p>
        </div>
        <button
          type="button"
          onclick="removeStagedNote(${nIdx})"
          class="text-xs text-rose-400 hover:text-rose-300 flex items-center gap-1"
        >
          <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
          <span>Remover Nota</span>
        </button>
      </div>

      ${(note.avisos_conferencia && note.avisos_conferencia.length)
        ? `<div role="alert" class="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200 space-y-1"><strong class="block text-amber-300">⚠ Confira esta nota antes de salvar</strong>${note.avisos_conferencia.map(a => `<p>${escapeSavedNoteText(a)}</p>`).join('')}</div>`
        : `<div class="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">✔ Totais conferem com a nota</div>`}

      <div class="space-y-3">
        ${note.operacoes.map((op, opIdx) => `
          <div class="p-3 rounded-xl bg-slate-950/90 border border-slate-800/90 space-y-3">
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <div>
                <label class="block text-[11px] text-slate-400 mb-1">Ticker</label>
                <input
                  type="text"
                  value="${op.ticker}"
                  onchange="updateStagedOpField(${nIdx}, ${opIdx}, 'ticker', this.value.toUpperCase())"
                  class="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs font-mono uppercase text-white"
                />
              </div>
              <div>
                <label class="block text-[11px] text-slate-400 mb-1">Especificação do Título</label>
                <input
                  type="text"
                  value="${op.especificacao}"
                  onchange="updateStagedOpField(${nIdx}, ${opIdx}, 'especificacao', this.value)"
                  class="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                />
              </div>
              <div>
                <label class="block text-[11px] text-slate-400 mb-1">Tipo da Ordem</label>
                <select
                  onchange="updateStagedOpField(${nIdx}, ${opIdx}, 'tipo_ordem', this.value)"
                  class="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                >
                  <option value="C" ${op.tipo_ordem === 'C' ? 'selected' : ''}>Compra (C)</option>
                  <option value="V" ${op.tipo_ordem === 'V' ? 'selected' : ''}>Venda (V)</option>
                </select>
              </div>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <div>
                <label class="block text-[11px] text-slate-400 mb-1">Quantidade</label>
                <div class="flex gap-1">
                  <input
                    type="number"
                    step="any"
                    id="stg-qtd-${nIdx}-${opIdx}"
                    value="${op.quantidade}"
                    onchange="updateStagedOpField(${nIdx}, ${opIdx}, 'quantidade', parseFloat(this.value)||0)"
                    class="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs font-mono text-white"
                  />
                  <button
                    type="button"
                    onclick="openCalculator('stg-qtd-${nIdx}-${opIdx}', 'Qtd (${op.ticker})')"
                    class="px-2 rounded-lg bg-indigo-500/20 text-indigo-300 border border-indigo-500/30"
                  >
                    <i data-lucide="calculator" class="w-3.5 h-3.5"></i>
                  </button>
                </div>
              </div>

              <div>
                <label class="block text-[11px] text-slate-400 mb-1">Valor Unitário (R$)</label>
                <div class="flex gap-1">
                  <input
                    type="number"
                    step="any"
                    id="stg-preco-${nIdx}-${opIdx}"
                    value="${op.preco_unitario}"
                    onchange="updateStagedOpField(${nIdx}, ${opIdx}, 'preco_unitario', parseFloat(this.value)||0)"
                    class="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs font-mono text-white"
                  />
                  <button
                    type="button"
                    onclick="openCalculator('stg-preco-${nIdx}-${opIdx}', 'Preço Unit. (${op.ticker})')"
                    class="px-2 rounded-lg bg-indigo-500/20 text-indigo-300 border border-indigo-500/30"
                  >
                    <i data-lucide="calculator" class="w-3.5 h-3.5"></i>
                  </button>
                </div>
              </div>

              <div>
                <label class="block text-[11px] text-slate-400 mb-1">Valor Operação (R$)</label>
                <div class="flex gap-1">
                  <input
                    type="number"
                    step="any"
                    id="stg-valop-${nIdx}-${opIdx}"
                    value="${op.valor_operacao}"
                    onchange="updateStagedOpField(${nIdx}, ${opIdx}, 'valor_operacao', parseFloat(this.value)||0)"
                    class="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs font-mono text-white"
                  />
                  <button
                    type="button"
                    onclick="openCalculator('stg-valop-${nIdx}-${opIdx}', 'Valor Operação (${op.ticker})')"
                    class="px-2 rounded-lg bg-indigo-500/20 text-indigo-300 border border-indigo-500/30"
                  >
                    <i data-lucide="calculator" class="w-3.5 h-3.5"></i>
                  </button>
                </div>
              </div>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1 border-t border-slate-800/70">
              <div>
                <label class="block text-[11px] text-slate-400 mb-1">Taxas CBLC (Liq/Reg R$)</label>
                <div class="flex gap-1">
                  <input
                    type="number"
                    step="any"
                    id="stg-cblc-${nIdx}-${opIdx}"
                    value="${op.taxa_cblc}"
                    onchange="updateStagedOpField(${nIdx}, ${opIdx}, 'taxa_cblc', parseFloat(this.value)||0)"
                    class="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs font-mono text-white"
                  />
                  <button
                    type="button"
                    onclick="openCalculator('stg-cblc-${nIdx}-${opIdx}', 'Taxa CBLC (${op.ticker})')"
                    class="px-2 rounded-lg bg-indigo-500/20 text-indigo-300 border border-indigo-500/30"
                  >
                    <i data-lucide="calculator" class="w-3.5 h-3.5"></i>
                  </button>
                </div>
              </div>

              <div>
                <label class="block text-[11px] text-slate-400 mb-1">Total Bovespa / Soma (R$)</label>
                <div class="flex gap-1">
                  <input
                    type="number"
                    step="any"
                    id="stg-bov-${nIdx}-${opIdx}"
                    value="${op.taxa_bovespa}"
                    onchange="updateStagedOpField(${nIdx}, ${opIdx}, 'taxa_bovespa', parseFloat(this.value)||0)"
                    class="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs font-mono text-white"
                  />
                  <button
                    type="button"
                    onclick="openCalculator('stg-bov-${nIdx}-${opIdx}', 'Taxa Bovespa (${op.ticker})')"
                    class="px-2 rounded-lg bg-indigo-500/20 text-indigo-300 border border-indigo-500/30"
                  >
                    <i data-lucide="calculator" class="w-3.5 h-3.5"></i>
                  </button>
                </div>
              </div>

              <div>
                <label class="block text-[11px] text-slate-400 mb-1">Corretagem / Despesas (R$)</label>
                <div class="flex gap-1">
                  <input
                    type="number"
                    step="any"
                    id="stg-corr-${nIdx}-${opIdx}"
                    value="${op.taxa_corretagem}"
                    onchange="updateStagedOpField(${nIdx}, ${opIdx}, 'taxa_corretagem', parseFloat(this.value)||0)"
                    class="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs font-mono text-white"
                  />
                  <button
                    type="button"
                    onclick="openCalculator('stg-corr-${nIdx}-${opIdx}', 'Corretagem (${op.ticker})')"
                    class="px-2 rounded-lg bg-indigo-500/20 text-indigo-300 border border-indigo-500/30"
                  >
                    <i data-lucide="calculator" class="w-3.5 h-3.5"></i>
                  </button>
                </div>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');

  lucide.createIcons();
}

function updateStagedOpField(nIdx, opIdx, field, value) {
  if (!stagedNotesQueue[nIdx] || !stagedNotesQueue[nIdx].operacoes[opIdx]) return;
  stagedNotesQueue[nIdx].operacoes[opIdx][field] = value;
}

function removeStagedNote(nIdx) {
  stagedNotesQueue.splice(nIdx, 1);
  renderStagingScreen();
}

function cancelStaging() {
  setStagedNotesQueue([]);
  renderStagingScreen();
  showToast('Importação cancelada.', 'info');
}

async function commitStagedNotesToSQLite() {
  if (stagedNotesQueue.length === 0) return;

  let importedCount = 0;
  try {
    db.run('BEGIN TRANSACTION;');

    for (const note of stagedNotesQueue) {
      if (isNoteAlreadyInSQLite(note.numero_controle)) {
        continue;
      }

      const corretoraId = ensureCorretora(note.corretora_nome, note.corretora_cnpj);
      db.run(
        `INSERT INTO notas_corretagem (
          numero_controle, data_pregao, valor_operacoes, total_cblc_bruto,
          taxa_cblc, taxa_bovespa, taxa_corretagem, valor_liquido_nota,
          nome_arquivo, arquivo_base64, criado_em, corretora_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          note.numero_controle,
          note.data_pregao,
          note.valor_operacoes,
          note.total_cblc_bruto,
          note.taxa_cblc,
          note.taxa_bovespa,
          note.taxa_corretagem,
          note.valor_liquido_nota,
          note.nome_arquivo,
          note.arquivo_base64,
          new Date().toISOString(),
          corretoraId
        ]
      );

      const noteIdRow = queryAll('SELECT last_insert_rowid() as id')[0];
      const notaId = noteIdRow ? noteIdRow.id : null;

      for (const op of note.operacoes) {
        db.run(
          `INSERT INTO operacoes (
            nota_id, numero_nota, data_operacao, ticker, especificacao,
            tipo_ordem, quantidade, preco_unitario, valor_operacao,
            taxa_cblc, taxa_bovespa, taxa_corretagem, corretora_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            notaId,
            note.numero_controle,
            note.data_pregao,
            (op.ticker || 'ATIVO').toUpperCase().trim(),
            op.especificacao || op.ticker,
            op.tipo_ordem || 'C',
            Number(op.quantidade) || 0,
            Number(op.preco_unitario) || 0,
            Number(op.valor_operacao) || 0,
            Number(op.taxa_cblc) || 0,
            Number(op.taxa_bovespa) || 0,
            Number(op.taxa_corretagem) || 0,
            corretoraId
          ]
        );
      }

      importedCount++;
    }

    db.run('COMMIT;');
    await persistSQLiteToIndexedDB();

    setStagedNotesQueue([]);
    renderStagingScreen();
    refreshAllViews();
    showToast(`${importedCount} nota(s) gravada(s) no banco de dados com sucesso!`, 'success');
    switchTab('carteira');
  } catch (err) {
    try { db.run('ROLLBACK;'); } catch (_) {}
    console.error('Erro ao salvar notas no SQLite:', err);
    showToast('Erro ao gravar no banco de dados.', 'error');
  }
}

// Histórico paginado de notas: consulta somente os campos usados na lista.
const SAVED_NOTES_PAGE_SIZE = 20;
let savedNotesCurrentPage = 0;

export function escapeSavedNoteText(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function getSavedNotesFilters() {
  const search = (document.getElementById('savedNotesSearch')?.value || '').trim();
  const year = document.getElementById('savedNotesYear')?.value || '';
  const month = document.getElementById('savedNotesMonth')?.value || '';
  const conditions = [];
  const params = [];

  if (search) {
    conditions.push(`(numero_controle LIKE ? OR data_pregao LIKE ? OR COALESCE(nome_arquivo, '') LIKE ?)`);
    const term = `%${search}%`;
    params.push(term, term, term);
  }
  const corr = document.getElementById('savedNotesCorretora')?.value || '';
  if (corr) { conditions.push('corretora_id = ?'); params.push(Number(corr)); }
  // As datas importadas pelo aplicativo usam DD/MM/AAAA.
  if (year) { conditions.push(`substr(data_pregao, 7, 4) = ?`); params.push(year); }
  if (month) { conditions.push(`substr(data_pregao, 4, 2) = ?`); params.push(month); }

  return { where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', params };
}

function populateSavedNotesYears() {
  const yearSelect = document.getElementById('savedNotesYear');
  if (!yearSelect) return;
  const selectedYear = yearSelect.value;
  const years = queryAll(`
    SELECT DISTINCT substr(data_pregao, 7, 4) AS ano
    FROM notas_corretagem
    WHERE length(data_pregao) >= 10 AND substr(data_pregao, 7, 4) GLOB '[0-9][0-9][0-9][0-9]'
    ORDER BY ano DESC
  `);
  yearSelect.innerHTML = '<option value="">Todos os anos</option>' + years
    .map(row => `<option value="${escapeSavedNoteText(row.ano)}">${escapeSavedNoteText(row.ano)}</option>`).join('');
  if (years.some(row => String(row.ano) === selectedYear)) yearSelect.value = selectedYear;
}

function filterSavedNotes(resetPage = true) {
  if (resetPage) savedNotesCurrentPage = 0;
  renderSavedNotesHistory();
}

function changeSavedNotesPage(delta) {
  const { where, params } = getSavedNotesFilters();
  const countRow = queryAll(`SELECT COUNT(*) AS total FROM notas_corretagem ${where}`, params)[0];
  const totalPages = Math.max(1, Math.ceil((Number(countRow?.total) || 0) / SAVED_NOTES_PAGE_SIZE));
  savedNotesCurrentPage = Math.min(Math.max(0, savedNotesCurrentPage + delta), totalPages - 1);
  renderSavedNotesHistory();
}

function base64ToBytes(b64) { const bin = atob(b64); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
function downloadPdfBytes(bytes, name) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const a = document.createElement('a'); a.href = url; a.download = name || 'nota-de-corretagem.pdf';
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
}
// Tela de leitura da nota salva: operações, taxas e o PDF original
function viewSavedNote(id) {
  const n = queryAll(`SELECT id, numero_controle, data_pregao, nome_arquivo, valor_operacoes, total_cblc_bruto, taxa_cblc, taxa_bovespa, taxa_corretagem, valor_liquido_nota, arquivo_base64,
    (SELECT nome FROM corretoras c WHERE c.id = notas_corretagem.corretora_id) AS corretora_nome FROM notas_corretagem WHERE id = ?`, [Number(id)])[0];
  if (!n) { showToast('Nota não encontrada.', 'error'); return; }
  const ops = queryAll('SELECT tipo_ordem, ticker, quantidade, preco_unitario, valor_operacao FROM operacoes WHERE nota_id = ? ORDER BY id', [n.id]);
  const el = (tag, cls, txt) => { const x = document.createElement(tag); if (cls) x.className = cls; if (txt != null) x.textContent = txt; return x; };
  const row = (l, v, strong) => { const r = el('div', 'flex items-baseline justify-between gap-3 py-1.5'); r.append(el('span', 'text-xs text-slate-400', l), el('span', 'text-xs font-mono text-right ' + (strong ? 'font-bold text-white' : 'text-slate-200'), v)); return r; };
  const old = document.getElementById('noteViewer'); if (old) old.remove();
  const ov = el('div', 'fixed inset-0 z-[150] bg-slate-950 overflow-y-auto'); ov.id = 'noteViewer'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
  const wrap = el('div', 'max-w-md mx-auto px-4 pb-10 space-y-5');
  const head = el('div', 'sticky top-0 z-10 -mx-4 px-4 py-3 bg-slate-950/95 backdrop-blur border-b border-slate-800 flex items-center justify-between gap-3');
  const ttl = el('div', 'min-w-0'); ttl.append(el('p', 'text-sm font-bold text-white truncate', 'Nota ' + n.numero_controle), el('p', 'text-[11px] text-slate-400 truncate', `Pregão ${n.data_pregao} · ${n.corretora_nome || 'Corretora não informada'}`));
  const close = el('button', 'shrink-0 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold', 'Fechar'); close.type = 'button';
  const shut = () => { ov.remove(); document.body.style.overflow = ''; };
  close.onclick = shut; head.append(ttl, close);
  const secOps = el('section', 'space-y-1'); secOps.append(el('h3', 'text-[11px] font-bold uppercase tracking-wider text-slate-500', `Operações (${ops.length})`));
  const list = el('div', 'divide-y divide-slate-800/70 rounded-2xl bg-slate-900/70 border border-slate-800 px-3');
  if (!ops.length) list.append(el('p', 'py-3 text-xs text-slate-500', 'Nenhuma operação vinculada a esta nota.'));
  ops.forEach(o => {
    const r = el('div', 'flex items-center justify-between gap-3 py-2.5');
    const l = el('div', 'flex items-center gap-2 min-w-0'); l.append(el('span', 'px-1.5 py-0.5 rounded text-[11px] font-semibold ' + (o.tipo_ordem === 'C' ? 'bg-slate-800 text-slate-200' : 'bg-amber-500/20 text-amber-300'), o.tipo_ordem === 'C' ? 'Compra' : 'Venda'), el('span', 'font-mono font-bold text-sm text-white truncate', o.ticker));
    const rt = el('div', 'text-right shrink-0'); rt.append(el('p', 'text-xs font-mono text-slate-300', `${formatNumber(o.quantidade)} × ${formatMoney(o.preco_unitario)}`), el('p', 'text-xs font-mono font-bold text-white', formatMoney(o.valor_operacao)));
    r.append(l, rt); list.append(r);
  });
  secOps.append(list);
  const secTot = el('section', 'space-y-1'); secTot.append(el('h3', 'text-[11px] font-bold uppercase tracking-wider text-slate-500', 'Valores da nota'));
  const tot = el('div', 'divide-y divide-slate-800/70 rounded-2xl bg-slate-900/70 border border-slate-800 px-3');
  tot.append(row('Valor das operações', formatMoney(n.valor_operacoes)), row('Total CBLC bruto', formatMoney(n.total_cblc_bruto)), row('Taxa CBLC', formatMoney(n.taxa_cblc)), row('Taxa Bovespa', formatMoney(n.taxa_bovespa)), row('Corretagem / despesas', formatMoney(n.taxa_corretagem)), row('Líquido da nota', formatMoney(n.valor_liquido_nota), true));
  secTot.append(tot);
  const secPdf = el('section', 'space-y-2'); const ph = el('div', 'flex items-center justify-between gap-3'); ph.append(el('h3', 'text-[11px] font-bold uppercase tracking-wider text-slate-500', 'PDF original'));
  const box = el('div', 'space-y-3');
  if (n.arquivo_base64) {
    const dl = el('button', 'px-3 py-1.5 rounded-xl bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/30 text-indigo-200 text-xs font-semibold', 'Baixar PDF'); dl.type = 'button';
    let bytes = null; try { bytes = base64ToBytes(n.arquivo_base64); } catch (_) {}
    dl.onclick = () => { if (bytes) downloadPdfBytes(bytes, n.nome_arquivo); else showToast('PDF indisponível.', 'error'); };
    ph.append(dl); box.append(el('p', 'text-xs text-slate-500', 'Carregando PDF…'));
    secPdf.append(ph, box);
    setTimeout(() => { if (!bytes) { box.textContent = 'Não foi possível ler o PDF guardado.'; return; }
      renderPdfPages(box, bytes).catch(() => { box.textContent = ''; box.append(el('p', 'text-xs text-slate-500', 'Não foi possível exibir o PDF aqui. Use “Baixar PDF” para abrir em outro aplicativo.')); }); }, 30);
  } else { box.append(el('p', 'text-xs text-slate-500', 'O PDF original não está guardado nesta nota.')); secPdf.append(ph, box); }
  wrap.append(head, secOps, secTot, secPdf); ov.append(wrap); document.body.append(ov); document.body.style.overflow = 'hidden';
}
export function renderSavedNotesHistory() {
  const listEl = document.getElementById('savedNotesList');
  const countBadge = document.getElementById('savedNotesCountBadge');
  if (!listEl || !countBadge || !db) return;

  populateSavedNotesYears();
  const { where, params } = getSavedNotesFilters();
  const countRow = queryAll(`SELECT COUNT(*) AS total FROM notas_corretagem ${where}`, params)[0];
  const total = Number(countRow?.total) || 0;
  const totalPages = Math.max(1, Math.ceil(total / SAVED_NOTES_PAGE_SIZE));
  savedNotesCurrentPage = Math.min(savedNotesCurrentPage, totalPages - 1);
  const offset = savedNotesCurrentPage * SAVED_NOTES_PAGE_SIZE;

  countBadge.textContent = `${total} ${total === 1 ? 'nota' : 'notas'}`;

  // Não usar SELECT *: arquivo_base64 pode conter PDFs grandes.
  const notes = total ? queryAll(`
    SELECT id, (SELECT nome FROM corretoras c WHERE c.id = notas_corretagem.corretora_id) AS corretora_nome, numero_controle, data_pregao, valor_liquido_nota,
           valor_operacoes, total_cblc_bruto, taxa_cblc,
           taxa_bovespa, taxa_corretagem, nome_arquivo
    FROM notas_corretagem
    ${where}
    ORDER BY id DESC
    LIMIT ? OFFSET ?
  `, [...params, SAVED_NOTES_PAGE_SIZE, offset]) : [];

  if (notes.length === 0) {
    listEl.innerHTML = `
      <div class="text-center py-7 text-xs text-slate-500">
        ${total === 0 && (document.getElementById('savedNotesSearch')?.value || document.getElementById('savedNotesYear')?.value || document.getElementById('savedNotesMonth')?.value)
          ? 'Nenhuma nota encontrada com esses filtros.'
          : 'Nenhuma nota de corretagem importada ainda.'}
      </div>`;
  } else {
    listEl.innerHTML = notes.map(n => `
      <div class="p-3 rounded-2xl bg-slate-900/90 border border-slate-800 text-xs space-y-2">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="min-w-0 flex-1 space-y-1">
            <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span class="font-mono font-bold text-emerald-400">Nr. ${escapeSavedNoteText(n.numero_controle)}</span>
              <span class="text-slate-400 font-mono">${escapeSavedNoteText(n.data_pregao)}</span>
            </div>
            <p class="text-[11px] text-slate-500 truncate">${escapeSavedNoteText(n.corretora_nome || 'Corretora não informada')} · ${escapeSavedNoteText(n.nome_arquivo || 'Arquivo salvo no banco')}</p>
          </div>
          <div class="flex items-center gap-3">
            <div class="text-right">
              <span class="text-[11px] text-slate-400 block">Líquido da Nota</span>
              <strong class="font-mono text-white">${formatMoney(n.valor_liquido_nota)}</strong>
            </div>
            <button type="button" onclick="viewSavedNote(${Number(n.id)})"
              class="p-2 rounded-xl bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-300 transition" title="Ver nota" aria-label="Ver nota ${escapeSavedNoteText(n.numero_controle)}">
              <i data-lucide="eye" class="w-4 h-4"></i>
            </button>
            <button type="button" onclick="deleteSavedNote(${Number(n.id)})"
              class="p-2 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 transition" title="Excluir Nota e suas Operações" aria-label="Excluir nota ${escapeSavedNoteText(n.numero_controle)}">
              <i data-lucide="trash-2" class="w-4 h-4"></i>
            </button>
          </div>
        </div>
        <details class="group border-t border-slate-800/80 pt-2">
          <summary class="cursor-pointer list-none flex items-center justify-between text-[11px] text-indigo-300 select-none">
            <span class="flex items-center gap-1"><i data-lucide="chevron-down" class="w-3 h-3"></i> Ver detalhes financeiros</span>
            <span class="text-slate-500">Abrir</span>
          </summary>
          <div class="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-3">
            <div><span class="block text-[11px] text-slate-500">Operações</span><strong class="text-slate-200 font-mono">${formatMoney(n.valor_operacoes)}</strong></div>
            <div><span class="block text-[11px] text-slate-500">Total CBLC bruto</span><strong class="text-slate-200 font-mono">${formatMoney(n.total_cblc_bruto)}</strong></div>
            <div><span class="block text-[11px] text-slate-500">Taxa CBLC</span><strong class="text-slate-200 font-mono">${formatMoney(n.taxa_cblc)}</strong></div>
            <div><span class="block text-[11px] text-slate-500">Taxa Bovespa</span><strong class="text-slate-200 font-mono">${formatMoney(n.taxa_bovespa)}</strong></div>
            <div><span class="block text-[11px] text-slate-500">Corretagem</span><strong class="text-slate-200 font-mono">${formatMoney(n.taxa_corretagem)}</strong></div>
          </div>
        </details>
      </div>
    `).join('');
  }

  const start = total ? offset + 1 : 0;
  const end = Math.min(offset + notes.length, total);
  const pageInfo = document.getElementById('savedNotesPageInfo');
  const pageNumber = document.getElementById('savedNotesPageNumber');
  const prev = document.getElementById('savedNotesPrev');
  const next = document.getElementById('savedNotesNext');
  if (pageInfo) pageInfo.textContent = total ? `Exibindo ${start}–${end} de ${total} notas` : 'Nenhuma nota';
  if (pageNumber) pageNumber.textContent = `${total ? savedNotesCurrentPage + 1 : 0} / ${total ? totalPages : 0}`;
  if (prev) prev.disabled = savedNotesCurrentPage <= 0 || total === 0;
  if (next) next.disabled = savedNotesCurrentPage >= totalPages - 1 || total === 0;
  if (window.lucide) lucide.createIcons();
}

async function deleteSavedNote(noteId) {
  const note = queryAll('SELECT numero_controle FROM notas_corretagem WHERE id = ?', [noteId])[0];
  if (!note) return;
  db.run('DELETE FROM operacoes WHERE nota_id = ?', [noteId]);
  db.run('DELETE FROM notas_corretagem WHERE id = ?', [noteId]);
  await persistSQLiteToIndexedDB();
  refreshAllViews();
  showToast(`Nota ${note.numero_controle} excluída do banco.`, 'info');
}

// Inserção Manual de Operação
function autoCalcManualTotal() {
  const qtd = parseFloat(document.getElementById('manQuantidade').value) || 0;
  const preco = parseFloat(document.getElementById('manPrecoUnitario').value) || 0;
  if (qtd > 0 && preco > 0) {
    document.getElementById('manValorOperacao').value = (qtd * preco).toFixed(2);
  }
}

async function saveManualOperation(event) {
  event.preventDefault();
  const ticker = document.getElementById('manTicker').value.toUpperCase().trim().replace(/F$/, '');
  const especificacao = document.getElementById('manEspecificacao').value.trim() || ticker;
  const tipoOrdem = document.getElementById('manTipoOrdem').value;
  const dataOp = document.getElementById('manData').value.trim();
  const numNota = document.getElementById('manNumNota').value.trim() || 'MANUAL';
  const quantidade = parseFloat(document.getElementById('manQuantidade').value) || 0;
  const precoUnitario = parseFloat(document.getElementById('manPrecoUnitario').value) || 0;
  const valorOperacao = parseFloat(document.getElementById('manValorOperacao').value) || (quantidade * precoUnitario);
  const taxaCblc = parseFloat(document.getElementById('manTaxaCblc').value) || 0;
  const taxaBovespa = parseFloat(document.getElementById('manTaxaBovespa').value) || 0;
  const taxaCorretagem = parseFloat(document.getElementById('manTaxaCorretagem').value) || 0;

  if (!ticker || quantidade <= 0 || precoUnitario <= 0) {
    showToast('Preencha Ticker, Quantidade e Valor Unitário corretamente.', 'error');
    return;
  }

  if (numNota !== 'MANUAL' && isNoteAlreadyInSQLite(numNota)) {
    showToast(`A nota ${numNota} já existe no banco de dados!`, 'error');
    return;
  }

  let corretoraId = null;
  const corrSel = document.getElementById('manCorretora').value;
  if (corrSel === '__new__') {
    const nomeNova = document.getElementById('manCorretoraNova').value.trim();
    if (!nomeNova) { showToast('Informe o nome da nova corretora.', 'error'); return; }
    corretoraId = ensureCorretora(nomeNova, null);
  } else if (corrSel) {
    corretoraId = Number(corrSel);
  }

  db.run(
    `INSERT INTO operacoes (
      nota_id, numero_nota, data_operacao, ticker, especificacao,
      tipo_ordem, quantidade, preco_unitario, valor_operacao,
      taxa_cblc, taxa_bovespa, taxa_corretagem, corretora_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      null,
      numNota,
      dataOp,
      ticker,
      especificacao,
      tipoOrdem,
      quantidade,
      precoUnitario,
      valorOperacao,
      taxaCblc,
      taxaBovespa,
      taxaCorretagem,
      corretoraId
    ]
  );

  await persistSQLiteToIndexedDB();
  document.getElementById('manualForm').reset();
  setTodayDateOnManualForm();
  onManCorretoraChange();
  refreshAllViews();
  showToast(`Lançamento manual de ${ticker} salvo no banco de dados!`, 'success');
  switchTab('carteira');
}

// Compatibilidade apenas para handlers inline no HTML/templates.
Object.assign(globalThis, {
  autoCalcManualTotal,
  cancelStaging,
  changeSavedNotesPage,
  commitStagedNotesToSQLite,
  deleteSavedNote,
  filterSavedNotes,
  handlePdfSelection,
  removeStagedNote,
  saveManualOperation,
  updateStagedOpField,
  viewSavedNote
});
