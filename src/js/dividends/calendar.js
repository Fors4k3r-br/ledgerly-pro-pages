// Motor puro do calendário de proventos: cruza dividendos.json com a custódia na data-com e com os lançamentos já registrados.
// Sem acesso a DOM, SQLite ou fetch.

import { isoToBR, toISODate } from '../core/utils.js';

const UNDEFINED_PAYMENT_VALUES = new Set(['', '-', '\u2013', '\u2014', 'n/d', 'nd', 'a definir']);

function normText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function normalizeDividendType(rawTipo) {
  const s = normText(rawTipo);
  if (!s) return 'OUTRO';
  if (s === 'jcp' || s.includes('juros') || s.includes('capital proprio')) return 'JCP';
  if (s.includes('dividendo') || s === 'div') return 'DIV';
  if (s.includes('rendimento') || s === 'rend') return 'REND';
  if (s.includes('amortiz')) return 'AMORT';
  return 'OUTRO';
}

export function parseDividendUnitValue(rawValor) {
  if (typeof rawValor === 'number') return Number.isFinite(rawValor) ? rawValor : NaN;
  const s = String(rawValor ?? '').replace(/R\$/gi, '').replace(/[\s\u00A0]/g, '').trim();
  if (!s) return NaN;
  const normalized = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : NaN;
}

export function isUndefinedPaymentDate(rawPag) {
  const s = normText(rawPag);
  if (UNDEFINED_PAYMENT_VALUES.has(s)) return true;
  return !toISODate(String(rawPag ?? '').trim());
}

function diffDaysISO(fromIso, toIso) {
  if (!fromIso || !toIso) return null;
  const a = Date.parse(`${fromIso}T12:00:00Z`);
  const b = Date.parse(`${toIso}T12:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

function buildOpsIndex(ops) {
  const byTicker = new Map();
  ops.forEach(op => {
    const ticker = String(op.ticker || '').toUpperCase().trim();
    const dataIso = toISODate(op.data_operacao);
    if (!ticker || !dataIso) return;
    if (!byTicker.has(ticker)) byTicker.set(ticker, []);
    byTicker.get(ticker).push({
      id: Number(op.id) || 0,
      dataIso,
      tipo: op.tipo_ordem,
      qtd: Number(op.quantidade) || 0,
      corretoraId: op.corretora_id != null ? Number(op.corretora_id) : null
    });
  });
  for (const list of byTicker.values()) {
    list.sort((a, b) => (a.dataIso !== b.dataIso ? a.dataIso.localeCompare(b.dataIso) : a.id - b.id));
  }
  return byTicker;
}

function computeCustodyAsOf(tickerOps, cutoffIso) {
  let total = 0;
  const byBroker = new Map();

  for (const op of tickerOps) {
    if (op.dataIso > cutoffIso) break;
    const key = op.corretoraId != null ? op.corretoraId : 'none';
    const curBroker = byBroker.get(key) || 0;
    if (op.tipo === 'C') {
      total += op.qtd;
      byBroker.set(key, curBroker + op.qtd);
    } else if (op.tipo === 'V') {
      total = Math.max(0, total - op.qtd);
      byBroker.set(key, Math.max(0, curBroker - op.qtd));
    }
  }

  let bestBroker = null;
  let bestQty = 0;
  for (const [k, q] of byBroker.entries()) {
    if (k !== 'none' && q > bestQty) {
      bestQty = q;
      bestBroker = Number(k);
    }
  }

  return {
    quantidade: Number(total.toFixed(8)),
    corretoraId: bestBroker
  };
}

function findMatchingRegistered(registeredProventos, matchedIds, candidate) {
  const comTag = `data-com ${candidate.dataComBR}`.toLowerCase();
  for (const reg of registeredProventos) {
    const id = Number(reg.id);
    if (matchedIds.has(id)) continue;
    if (String(reg.ticker || '').toUpperCase().trim() !== candidate.ticker) continue;
    if (String(reg.tipo || '').toUpperCase().trim() !== candidate.tipoCode) continue;

    const obs = String(reg.observacao || '').toLowerCase();
    if (obs.includes(comTag)) return reg;

    if (candidate.pagamentoIso) {
      const regIso = toISODate(reg.data_pagamento);
      const dayGap = regIso ? Math.abs(diffDaysISO(regIso, candidate.pagamentoIso)) : 999;
      if (dayGap <= 5) {
        const regBruto = Number(reg.valor_bruto) || 0;
        const regLiq = Number(reg.valor_liquido) || 0;
        const tolBruto = Math.max(0.10, candidate.valorBruto * 0.03);
        const tolLiq = Math.max(0.10, candidate.valorLiquido * 0.03);
        if (Math.abs(regBruto - candidate.valorBruto) <= tolBruto || Math.abs(regLiq - candidate.valorLiquido) <= tolLiq) {
          return reg;
        }
      }
    }
  }
  return null;
}

export function buildDividendCalendar({
  feed = null,
  ops = [],
  registeredProventos = [],
  todayIso = ''
} = {}) {
  const acoes = (feed && typeof feed === 'object' && feed.acoes && typeof feed.acoes === 'object') ? feed.acoes : {};
  const opsByTicker = buildOpsIndex(ops);
  const matchedProvIds = new Set();

  const items = [];
  const hiddenItems = [];

  for (const [rawTicker, rawList] of Object.entries(acoes)) {
    const ticker = String(rawTicker || '').toUpperCase().trim();
    if (!ticker || !Array.isArray(rawList) || !opsByTicker.has(ticker)) continue;

    const tickerOps = opsByTicker.get(ticker);
    const currentCustody = computeCustodyAsOf(tickerOps, todayIso || '9999-12-31');
    const buyOps = tickerOps.filter(op => op.tipo === 'C' && op.qtd > 0);
    const firstBuyIso = buyOps.length ? buyOps[0].dataIso : '';

    rawList.forEach(entry => {
      if (!entry || typeof entry !== 'object') return;
      const dataComIso = toISODate(entry.data_com);
      const dataExIso = toISODate(entry.data_ex);
      const valorUnitario = parseDividendUnitValue(entry.valor);
      if (!dataComIso || !(valorUnitario > 0)) return;

      const pagamentoIndefinido = isUndefinedPaymentDate(entry.pagamento);
      const pagamentoIso = pagamentoIndefinido ? '' : toISODate(entry.pagamento);
      const tipoCode = normalizeDividendType(entry.tipo);
      const tipoRaw = String(entry.tipo || '').trim() || tipoCode;
      const dataComBR = isoToBR(dataComIso);
      const dataExBR = dataExIso ? isoToBR(dataExIso) : '—';
      const pagamentoBR = pagamentoIso ? isoToBR(pagamentoIso) : 'A definir';

      // Para data-com futura, projeta com a custódia atual; para data-com passada ou hoje, usa a custódia exata na data-com.
      const isFutureCom = Boolean(todayIso && dataComIso > todayIso);
      const cutoffIso = isFutureCom ? todayIso : dataComIso;
      const custody = computeCustodyAsOf(tickerOps, cutoffIso);

      if (!(custody.quantidade > 0)) {
        if (currentCustody.quantidade > 0) {
          const hadBuyOnOrBeforeCom = buyOps.some(op => op.dataIso <= dataComIso);
          const nextBuyAfterCom = buyOps.find(op => op.dataIso > dataComIso);
          const purchaseDateIso = nextBuyAfterCom ? nextBuyAfterCom.dataIso : firstBuyIso;
          hiddenItems.push({
            key: `hidden|${ticker}|${tipoCode}|${dataComIso}|${pagamentoIso || 'indefinido'}|${valorUnitario.toFixed(6)}`,
            ticker,
            tipoRaw,
            tipoCode,
            valorUnitario,
            dataComIso,
            dataComBR,
            dataExIso,
            dataExBR,
            pagamentoIso,
            pagamentoBR,
            pagamentoIndefinido,
            purchaseDateIso,
            purchaseDateBR: purchaseDateIso ? isoToBR(purchaseDateIso) : '—',
            purchaseDateLabel: hadBuyOnOrBeforeCom ? 'Sua compra posterior' : 'Sua primeira compra',
            qtdAtual: currentCustody.quantidade
          });
        }
        return;
      }

      const valorBruto = Number((custody.quantidade * valorUnitario).toFixed(2));
      const imposto = tipoCode === 'JCP' ? Number((valorBruto * 0.15).toFixed(2)) : 0;
      const valorLiquido = Number((valorBruto - imposto).toFixed(2));
      const qtdAtual = currentCustody.quantidade;
      const isSoldAfterCom = !isFutureCom && qtdAtual <= 1e-6;
      const isPartialRight = !isFutureCom && qtdAtual > 1e-6 && Math.abs(qtdAtual - custody.quantidade) > 1e-6;

      const candidate = {
        key: `${ticker}|${tipoCode}|${dataComIso}|${pagamentoIso || 'indefinido'}|${valorUnitario.toFixed(6)}`,
        ticker,
        tipoRaw,
        tipoCode,
        valorUnitario,
        qtdNaDataCom: custody.quantidade,
        qtdAtual,
        isPartialRight,
        isSoldAfterCom,
        corretoraId: custody.corretoraId,
        valorBruto,
        imposto,
        valorLiquido,
        dataComIso,
        dataComBR,
        dataExIso,
        dataExBR,
        pagamentoIso,
        pagamentoBR,
        pagamentoIndefinido,
        isFutureCom,
        daysToCom: todayIso ? diffDaysISO(todayIso, dataComIso) : null,
        daysToEx: (todayIso && dataExIso) ? diffDaysISO(todayIso, dataExIso) : null,
        daysToPay: (todayIso && pagamentoIso) ? diffDaysISO(todayIso, pagamentoIso) : null
      };

      const matched = findMatchingRegistered(registeredProventos, matchedProvIds, candidate);
      if (matched) {
        matchedProvIds.add(Number(matched.id));
        candidate.status = 'registrado';
        candidate.registeredId = Number(matched.id);
      } else if (pagamentoIndefinido || !pagamentoIso) {
        candidate.status = 'a_definir';
        candidate.registeredId = null;
      } else if (todayIso && pagamentoIso <= todayIso) {
        candidate.status = 'a_confirmar';
        candidate.registeredId = null;
      } else {
        candidate.status = 'previsto';
        candidate.registeredId = null;
      }

      items.push(candidate);
    });
  }

  const order = { a_confirmar: 0, previsto: 1, a_definir: 2, registrado: 3 };
  items.sort((a, b) => {
    if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
    if (a.status === 'previsto') {
      if (a.pagamentoIso !== b.pagamentoIso) return a.pagamentoIso.localeCompare(b.pagamentoIso);
      return a.ticker.localeCompare(b.ticker);
    }
    if (a.status === 'a_confirmar' || a.status === 'registrado') {
      const pa = a.pagamentoIso || a.dataComIso;
      const pb = b.pagamentoIso || b.dataComIso;
      if (pa !== pb) return pb.localeCompare(pa);
      return a.ticker.localeCompare(b.ticker);
    }
    if (a.dataComIso !== b.dataComIso) return b.dataComIso.localeCompare(a.dataComIso);
    return a.ticker.localeCompare(b.ticker);
  });

  hiddenItems.sort((a, b) => {
    if (a.dataComIso !== b.dataComIso) return b.dataComIso.localeCompare(a.dataComIso);
    return a.ticker.localeCompare(b.ticker);
  });

  const hiddenTickers = new Set(hiddenItems.map(h => h.ticker));

  const summary = {
    total: items.length,
    countAConfirmar: 0,
    countPrevisto: 0,
    countADefinir: 0,
    countRegistrado: 0,
    totalPrevistoLiquido: 0,
    totalAConfirmarLiquido: 0,
    ignoredBeforePurchase: hiddenItems.length,
    hiddenTickerCount: hiddenTickers.size,
    proximoPagamento: null
  };

  items.forEach(item => {
    if (item.status === 'a_confirmar') {
      summary.countAConfirmar++;
      summary.totalAConfirmarLiquido += item.valorLiquido;
    } else if (item.status === 'previsto') {
      summary.countPrevisto++;
      summary.totalPrevistoLiquido += item.valorLiquido;
      if (!summary.proximoPagamento) summary.proximoPagamento = item;
    } else if (item.status === 'a_definir') {
      summary.countADefinir++;
      summary.totalPrevistoLiquido += item.valorLiquido;
    } else if (item.status === 'registrado') {
      summary.countRegistrado++;
    }
  });

  summary.totalPrevistoLiquido = Number(summary.totalPrevistoLiquido.toFixed(2));
  summary.totalAConfirmarLiquido = Number(summary.totalAConfirmarLiquido.toFixed(2));

  return {
    items,
    hiddenItems,
    summary,
    meta: {
      atualizadoEm: feed?.atualizado_em || feed?.ultima_execucao || null,
      status: feed?.status || 'unknown',
      erro: feed?.erro || null,
      totalAtivosFeed: Object.keys(acoes).length
    }
  };
}
