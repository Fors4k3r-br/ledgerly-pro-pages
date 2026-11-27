// Cálculos puros da carteira: não acessa DOM, SQLite, IndexedDB ou APIs.
// A camada principal fornece os registros já consultados no banco.
export function calculateConsolidatedPositions({ ops = [], quotesRows = [], lastPrice = {}, provRows = [], corretoraId = null } = {}) {
  const quotesMap = {};
  quotesRows.forEach(r => { quotesMap[r.ticker] = Number(r.preco_atual); });

  const map = {};
  ops.forEach(op => {
    const ticker = (op.ticker || '').toUpperCase().trim();
    if (!map[ticker]) {
      map[ticker] = {
        ticker,
        especificacao: op.especificacao || ticker,
        qtdAtual: 0,
        qtdComprada: 0,
        qtdVendida: 0,
        custoTotalAcumulado: 0,
        precoMedio: 0,
        totalTaxasCblc: 0,
        totalTaxasBovespa: 0,
        totalTaxasCorretagem: 0,
        resultadoRealizado: 0,
        qtdOperacoes: 0,
        ultimoPrecoNegociado: Number(op.preco_unitario),
        operacoes: []
      };
    }

    const item = map[ticker];
    if (op.especificacao && op.especificacao.length > item.especificacao.length) item.especificacao = op.especificacao;

    const qtd = Number(op.quantidade) || 0;
    const valorOp = Number(op.valor_operacao) || (qtd * Number(op.preco_unitario));
    const tCblc = Number(op.taxa_cblc) || 0;
    const tBov = Number(op.taxa_bovespa) || 0;
    const tCorr = Number(op.taxa_corretagem) || 0;
    const taxasOp = tCblc + tBov + tCorr;

    item.totalTaxasCblc += tCblc;
    item.totalTaxasBovespa += tBov;
    item.totalTaxasCorretagem += tCorr;
    item.ultimoPrecoNegociado = Number(op.preco_unitario);
    item.qtdOperacoes += 1;
    item.operacoes.push(op);

    if (op.tipo_ordem === 'C') {
      // Compra: soma ao custo de aquisição o valor da operação + taxas.
      const custoCompra = valorOp + taxasOp;
      item.qtdComprada += qtd;
      item.qtdAtual += qtd;
      item.custoTotalAcumulado += custoCompra;
      item.precoMedio = item.qtdAtual > 0 ? (item.custoTotalAcumulado / item.qtdAtual) : 0;
    } else if (op.tipo_ordem === 'V') {
      // Venda: apura resultado realizado pelo preço médio vigente antes da venda.
      const qtdBaixada = Math.min(qtd, item.qtdAtual);
      const receitaLiquida = valorOp - taxasOp;
      const receitaProporcional = qtd > 0 ? receitaLiquida * (qtdBaixada / qtd) : 0;
      item.resultadoRealizado += receitaProporcional - (qtdBaixada * item.precoMedio);
      item.qtdVendida += qtd;
      item.qtdAtual = Math.max(0, item.qtdAtual - qtd);
      item.custoTotalAcumulado = item.qtdAtual * item.precoMedio;
    }
  });

  const provMap = {};
  provRows.forEach(r => { provMap[r.ticker] = Number(r.total) || 0; });
  return Object.values(map).map(pos => {
    const cotacaoAtual = quotesMap[pos.ticker] !== undefined
      ? quotesMap[pos.ticker]
      : (lastPrice[pos.ticker] ? lastPrice[pos.ticker].p : pos.ultimoPrecoNegociado);
    const valorInvestido = pos.qtdAtual * pos.precoMedio;
    const patrimonioAtual = pos.qtdAtual * cotacaoAtual;
    const lucroPrejuizo = patrimonioAtual - valorInvestido;
    const rentabilidade = valorInvestido > 0 ? ((lucroPrejuizo / valorInvestido) * 100) : 0;
    const totalTaxas = pos.totalTaxasCblc + pos.totalTaxasBovespa + pos.totalTaxasCorretagem;
    return {
      ...pos,
      cotacaoAtual,
      valorInvestido,
      patrimonioAtual,
      lucroPrejuizo,
      rentabilidade,
      totalTaxas,
      proventosRecebidos: provMap[pos.ticker] || 0,
      filtradoCorretora: Boolean(corretoraId),
      rentabilidadeTotal: valorInvestido > 0 ? (((lucroPrejuizo + (provMap[pos.ticker] || 0)) / valorInvestido) * 100) : 0,
      pesoCarteira: 0
    };
  });
}

