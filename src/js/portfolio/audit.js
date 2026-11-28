// Motor puro de auditoria da carteira e batimento de custódia (sem acesso ao DOM ou SQLite).

import { formatMoney, formatNumber, toISODate } from '../core/utils.js';
import { classifyTicker } from './sectors.js';

export function runPortfolioAudit({
  ops = [],
  notes = [],
  quotesRows = [],
  provRows = [],
  positions = [],
  brapiLastSyncIso = null,
  dbIntegrity = { centralOk: true, centralFkIssues: 0, dailyOk: true, dailyFkIssues: 0 }
} = {}) {
  const critical = [];
  const warnings = [];

  // 1. Integridade física e chaves estrangeiras dos bancos SQLite
  if (!dbIntegrity.centralOk || dbIntegrity.centralFkIssues > 0) {
    critical.push({
      id: 'db-central-integrity',
      category: 'Integridade do banco',
      title: 'Falha de integridade detectada no central.db',
      detail: !dbIntegrity.centralOk
        ? 'PRAGMA integrity_check retornou erro no banco principal. Faça backup antes de alterar dados.'
        : `${dbIntegrity.centralFkIssues} vínculo(s) inválido(s) encontrado(s) em PRAGMA foreign_key_check.`,
      action: 'switchTab',
      actionArg: 'banco',
      actionLabel: 'Abrir Banco'
    });
  }
  if (!dbIntegrity.dailyOk || dbIntegrity.dailyFkIssues > 0) {
    critical.push({
      id: 'db-daily-integrity',
      category: 'Integridade do banco',
      title: 'Falha de integridade detectada no daily.db',
      detail: !dbIntegrity.dailyOk
        ? 'PRAGMA integrity_check retornou erro no histórico patrimonial diário.'
        : `${dbIntegrity.dailyFkIssues} vínculo(s) inválido(s) encontrado(s) no daily.db.`,
      action: 'switchTab',
      actionArg: 'banco',
      actionLabel: 'Abrir Banco'
    });
  }

  // 2. Vendas acima da custódia disponível (ordem cronológica real: data_operacao, id)
  const chronologicalOps = ops.slice().sort((a, b) => {
    const da = toISODate(a.data_operacao) || '9999-99-99';
    const dbDate = toISODate(b.data_operacao) || '9999-99-99';
    if (da !== dbDate) return da.localeCompare(dbDate);
    return (Number(a.id) || 0) - (Number(b.id) || 0);
  });

  const runningQty = new Map();
  chronologicalOps.forEach(op => {
    const ticker = String(op.ticker || '').toUpperCase().trim();
    const qtd = Number(op.quantidade) || 0;
    if (!ticker || qtd <= 0) return;

    const current = runningQty.get(ticker) || 0;
    if (op.tipo_ordem === 'C') {
      runningQty.set(ticker, current + qtd);
    } else if (op.tipo_ordem === 'V') {
      if (qtd > current + 1e-6) {
        const falta = qtd - current;
        critical.push({
          id: `oversell-${op.id}`,
          category: 'Saldo descoberto',
          title: `${ticker}: venda maior que a custódia em ${op.data_operacao}`,
          detail: `Venda de ${formatNumber(qtd)} com saldo anterior de ${formatNumber(current)} (faltam ${formatNumber(falta)} — verifique nota de compra ausente, bonificação ou data incorreta).`,
          action: 'focusTicker',
          actionArg: ticker,
          actionLabel: 'Ver ativo'
        });
      }
      runningQty.set(ticker, Math.max(0, current - qtd));
    }
  });

  // 3. Conferência entre notas de corretagem e operações vinculadas
  const opsByNote = new Map();
  ops.forEach(op => {
    if (op.nota_id == null) return;
    const key = Number(op.nota_id);
    if (!opsByNote.has(key)) opsByNote.set(key, []);
    opsByNote.get(key).push(op);
  });

  notes.forEach(note => {
    const linked = opsByNote.get(Number(note.id)) || [];
    if (!linked.length) {
      warnings.push({
        id: `empty-note-${note.id}`,
        category: 'Nota sem operações',
        title: `Nota ${note.numero_controle} (${note.data_pregao}) está sem operações`,
        detail: 'Todas as operações desta nota foram removidas ou não foram gravadas.',
        action: 'viewSavedNote',
        actionArg: String(note.id),
        actionLabel: 'Ver nota'
      });
      return;
    }

    const saldoOps = linked.reduce((acc, o) => acc + (o.tipo_ordem === 'V' ? (Number(o.valor_operacao) || 0) : -(Number(o.valor_operacao) || 0)), 0);
    const taxasOps = linked.reduce((acc, o) => acc + (Number(o.taxa_cblc) || 0) + (Number(o.taxa_bovespa) || 0) + (Number(o.taxa_corretagem) || 0), 0);
    const valOpsNota = Number(note.valor_operacoes) || 0;
    const valLiqNota = Number(note.valor_liquido_nota) || 0;

    if (valOpsNota > 0 && Math.abs(Math.abs(saldoOps) - valOpsNota) > 0.05) {
      critical.push({
        id: `note-ops-${note.id}`,
        category: 'Divergência em nota',
        title: `Nota ${note.numero_controle} (${note.data_pregao}) diverge no valor das operações`,
        detail: `Operações vinculadas somam ${formatMoney(Math.abs(saldoOps))}, mas a nota registra ${formatMoney(valOpsNota)}.`,
        action: 'viewSavedNote',
        actionArg: String(note.id),
        actionLabel: 'Abrir nota'
      });
    } else if (valLiqNota > 0) {
      const esperado = saldoOps < 0 ? Math.abs(saldoOps) + taxasOps : Math.abs(saldoOps) - taxasOps;
      if (Math.abs(esperado - valLiqNota) > 0.05) {
        warnings.push({
          id: `note-liq-${note.id}`,
          category: 'Divergência em nota',
          title: `Nota ${note.numero_controle} (${note.data_pregao}) diverge no valor líquido`,
          detail: `Operações e taxas resultam em ${formatMoney(esperado)}, mas o líquido salvo é ${formatMoney(valLiqNota)} (pode incluir IRRF ou outras despesas).`,
          action: 'viewSavedNote',
          actionArg: String(note.id),
          actionLabel: 'Abrir nota'
        });
      }
    }
  });

  // 4. Possíveis lançamentos duplicados
  const dupGroups = new Map();
  ops.forEach(op => {
    const key = [
      String(op.ticker || '').toUpperCase().trim(),
      toISODate(op.data_operacao) || String(op.data_operacao || '').trim(),
      op.tipo_ordem,
      Number(op.quantidade || 0).toFixed(6),
      Number(op.preco_unitario || 0).toFixed(4)
    ].join('|');
    if (!dupGroups.has(key)) dupGroups.set(key, []);
    dupGroups.get(key).push(op);
  });

  dupGroups.forEach(group => {
    if (group.length < 2) return;
    const first = group[0];
    const distinctSources = new Set(group.map(o => o.nota_id ? `nota:${o.nota_id}` : 'manual'));
    // Mesmo pregão com 2 ordens iguais na mesma nota pode ser legítimo (execução parcial),
    // então sinaliza como alerta; entre fontes distintas (manual + PDF ou 2 notas) sobe para crítico.
    const targetList = distinctSources.size > 1 ? critical : warnings;
    targetList.push({
      id: `dup-${first.id}`,
      category: 'Possível duplicidade',
      title: `${first.ticker}: ${group.length} lançamentos idênticos em ${first.data_operacao}`,
      detail: `${first.tipo_ordem === 'C' ? 'Compra' : 'Venda'} de ${formatNumber(first.quantidade)} × ${formatMoney(first.preco_unitario)}${distinctSources.size > 1 ? ' em origens diferentes (ex.: manual e nota PDF).' : ' na mesma nota/origem.'}`,
      action: 'focusTicker',
      actionArg: String(first.ticker || '').toUpperCase().trim(),
      actionLabel: 'Conferir ativo'
    });
  });

  // 5. Registros inválidos (datas malformadas, valores <= 0 ou tipo desconhecido)
  ops.forEach(op => {
    const ticker = String(op.ticker || '').toUpperCase().trim() || 'SEM TICKER';
    const problems = [];
    if (!toISODate(op.data_operacao)) problems.push(`data inválida ("${op.data_operacao || ''}")`);
    if (!['C', 'V'].includes(op.tipo_ordem)) problems.push(`tipo inválido ("${op.tipo_ordem || ''}")`);
    if (!(Number(op.quantidade) > 0)) problems.push('quantidade zerada ou negativa');
    if (!(Number(op.preco_unitario) > 0) && !(Number(op.valor_operacao) > 0)) problems.push('preço/valor zerado');
    if (problems.length) {
      critical.push({
        id: `invalid-op-${op.id}`,
        category: 'Dados inválidos',
        title: `${ticker}: operação #${op.id} com inconsistência`,
        detail: `Problemas encontrados: ${problems.join(', ')}.`,
        action: ticker !== 'SEM TICKER' ? 'focusTicker' : 'switchTab',
        actionArg: ticker !== 'SEM TICKER' ? ticker : 'posicoes',
        actionLabel: 'Revisar'
      });
    }
  });

  // 6. Pendências de organização
  const opsSemCorretora = ops.filter(op => op.corretora_id == null);
  if (opsSemCorretora.length > 0) {
    warnings.push({
      id: 'ops-no-broker',
      category: 'Organização',
      title: `${opsSemCorretora.length} ${opsSemCorretora.length === 1 ? 'operação sem corretora' : 'operações sem corretora'}`,
      detail: 'Vincular corretora facilita o batimento por instituição e a declaração anual.',
      action: 'focusCorretora',
      actionArg: 'none',
      actionLabel: 'Filtrar ativos'
    });
  }

  const provSemCorretora = provRows.filter(p => p.corretora_id == null);
  if (provSemCorretora.length > 0) {
    warnings.push({
      id: 'prov-no-broker',
      category: 'Organização',
      title: `${provSemCorretora.length} ${provSemCorretora.length === 1 ? 'provento sem corretora' : 'proventos sem corretora'}`,
      detail: 'Registros antigos ou manuais de proventos sem instituição informada.',
      action: 'switchTab',
      actionArg: 'proventos',
      actionLabel: 'Abrir Proventos'
    });
  }

  const activePositions = positions.filter(p => p.qtdAtual > 0);
  const quotedSet = new Set(quotesRows.filter(q => Number(q.preco_atual) > 0).map(q => String(q.ticker || '').toUpperCase().trim()));
  const unquoted = activePositions.filter(p => !quotedSet.has(p.ticker)).map(p => p.ticker);
  if (unquoted.length > 0) {
    warnings.push({
      id: 'missing-quotes',
      category: 'Cotações',
      title: `${unquoted.length} ${unquoted.length === 1 ? 'ativo aberto sem cotação' : 'ativos abertos sem cotação'}`,
      detail: `Usando último preço negociado para: ${unquoted.slice(0, 6).join(', ')}${unquoted.length > 6 ? '…' : ''}.`,
      action: 'syncAllQuotesFromBrapi',
      actionArg: '',
      actionLabel: 'Atualizar cotações'
    });
  } else if (activePositions.length > 0 && brapiLastSyncIso) {
    const ageDays = (Date.now() - Date.parse(brapiLastSyncIso)) / 86400000;
    if (Number.isFinite(ageDays) && ageDays > 7) {
      warnings.push({
        id: 'stale-quotes',
        category: 'Cotações',
        title: `Cotações desatualizadas há ${Math.floor(ageDays)} dias`,
        detail: 'Atualize as cotações para manter o valor de mercado e os snapshots diários precisos.',
        action: 'syncAllQuotesFromBrapi',
        actionArg: '',
        actionLabel: 'Atualizar agora'
      });
    }
  }

  const pendingSector = [];
  const seenCodes = new Set();
  activePositions.forEach(p => {
    const cl = classifyTicker(p.ticker);
    if (cl.origem === 'pendente' && !seenCodes.has(cl.code)) {
      seenCodes.add(cl.code);
      pendingSector.push(p.ticker);
    }
  });
  if (pendingSector.length > 0) {
    warnings.push({
      id: 'pending-sectors',
      category: 'Setores',
      title: `${pendingSector.length} ${pendingSector.length === 1 ? 'ativo sem setor' : 'ativos sem setor'}`,
      detail: `Pendentes de classificação: ${pendingSector.slice(0, 6).join(', ')}${pendingSector.length > 6 ? '…' : ''}.`,
      action: 'openSectorEditor',
      actionArg: pendingSector[0],
      actionLabel: 'Classificar'
    });
  }

  return {
    critical,
    warnings,
    dbIntegrity,
    stats: {
      totalOps: ops.length,
      totalNotes: notes.length,
      activePositions: activePositions.length,
      criticalCount: critical.length,
      warningCount: warnings.length
    }
  };
}

export function buildCustodyReconciliation({
  positions = [],
  externalMap = null,
  manualMap = {},
  checkedMap = {}
} = {}) {
  const activeMap = new Map();
  positions.filter(p => p.qtdAtual > 0).forEach(p => activeMap.set(p.ticker, p));

  const allTickers = new Set(activeMap.keys());
  if (externalMap) {
    Object.keys(externalMap).forEach(t => allTickers.add(t));
  }

  const rows = [];
  let conferidos = 0;
  let divergentes = 0;
  let pendentes = 0;
  let somenteArquivo = 0;
  let somenteApp = 0;

  allTickers.forEach(ticker => {
    const appPos = activeMap.get(ticker) || null;
    const ext = externalMap ? (externalMap[ticker] || null) : null;
    const qtdApp = appPos ? Number(appPos.qtdAtual) || 0 : 0;

    const hasManual = Object.prototype.hasOwnProperty.call(manualMap, ticker)
      && manualMap[ticker] !== '' && manualMap[ticker] !== null && manualMap[ticker] !== undefined;
    const manualNum = hasManual ? Number(manualMap[ticker]) : NaN;

    let qtdRef = null;
    let refSource = null;
    if (hasManual && Number.isFinite(manualNum)) {
      qtdRef = manualNum;
      refSource = 'manual';
    } else if (ext && Number.isFinite(Number(ext.quantidade))) {
      qtdRef = Number(ext.quantidade);
      refSource = 'arquivo';
    }

    const diff = qtdRef !== null ? Number((qtdApp - qtdRef).toFixed(8)) : null;
    const isMatch = diff !== null && Math.abs(diff) <= 1e-6;
    const isDivergent = diff !== null && Math.abs(diff) > 1e-6;
    const manualChecked = Boolean(checkedMap[ticker]);
    const onlyInFile = !appPos && Boolean(ext);
    const onlyInAppWithFile = Boolean(appPos) && Boolean(externalMap) && !ext && !hasManual;

    let status = 'pendente';
    if (isDivergent || onlyInFile || onlyInAppWithFile) {
      status = 'divergente';
      divergentes++;
      if (onlyInFile) somenteArquivo++;
      if (onlyInAppWithFile) somenteApp++;
    } else if (manualChecked || isMatch) {
      status = 'ok';
      conferidos++;
    } else {
      pendentes++;
    }

    rows.push({
      ticker,
      especificacao: appPos?.especificacao || '',
      qtdApp,
      precoMedio: appPos ? (Number(appPos.precoMedio) || 0) : 0,
      valorInvestido: appPos ? (Number(appPos.valorInvestido) || 0) : 0,
      qtdRef,
      refSource,
      diff,
      isMatch,
      isDivergent,
      onlyInFile,
      onlyInAppWithFile,
      manualChecked,
      status,
      extPrice: ext?.preco ?? null,
      extAvgPrice: ext?.precoMedio ?? null,
      extInstitutions: ext?.instituicoes || []
    });
  });

  const order = { divergente: 0, pendente: 1, ok: 2 };
  rows.sort((a, b) => {
    if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
    return a.ticker.localeCompare(b.ticker);
  });

  return {
    rows,
    summary: {
      total: rows.length,
      conferidos,
      divergentes,
      pendentes,
      somenteArquivo,
      somenteApp
    }
  };
}
