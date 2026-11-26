// Interpretação financeira de notas de corretagem no padrão SINACOR.
// Mantém a lógica de extração, conferência e rateio que antes ficava no index.html.

// Parser para notas no padrão SINACOR (testado com a nota 29102026/3.182)
export function parseSinacorNote(text, fileName, base64Pdf) {
      // Normaliza o texto e substitui caracteres cirílicos/especiais comuns em PDFs do BB (ex: 'З' cirílico por '3')
      const normalized = text.replace(/\s+/g, ' ')
                             .replace(/[ЗЗ3]/g, (m) => '3')
                             .replace(/[О0]/g, (m) => m === '0' ? '0' : 'O')
                             .replace(/[АA]/g, 'A');

      // 1. Extrai Número de Controle da Nota (ex: 29102026/3.182)
      let numeroControle = '';
      const nrNotaMatch = normalized.match(/(\d{7,8}\/\d+(?:\.\d+)?)/) ||
                          normalized.match(/\b(\d{5,12})\s+Nr\.?\s*nota\b/i) ||
                          normalized.match(/Nr\.?\s*Nota\s*[:\-]?\s*([0-9\/.-]+)/i);
      if (nrNotaMatch) {
        numeroControle = nrNotaMatch[1].trim();
      } else {
        numeroControle = 'NOTA-' + fileName.replace(/\.pdf$/i, '').toUpperCase();
      }

      // 2. Extrai Data do Pregão (ex: 29/10/2026)
      let dataPregao = '';
      const dateMatch = normalized.match(/(\d{2}\/\d{2}\/\d{4})\s+Data\s+preg[aã]o/i) ||
                        normalized.match(/Data\s+preg[aã]o.*?(\d{2}\/\d{2}\/\d{4})/i) ||
                        normalized.match(/(\d{2}\/\d{2}\/\d{4})/);
      if (dateMatch) {
        dataPregao = dateMatch[1];
      } else {
        const hj = new Date();
        dataPregao = hj.toLocaleDateString('pt-BR');
      }

      // 3. Extrai Taxas do Resumo Financeiro com proteção contra a armadilha do "Total CBLC"
      const parseBrFloat = (str) => {
        if (!str) return 0;
        const clean = str.trim().replace(/\.(?=\d{3}(?:[.,]|$))/g, '').replace(',', '.');
        return parseFloat(clean) || 0;
      };

      const matchValAfterLabel = (regex) => {
        const m = normalized.match(regex);
        return m ? parseBrFloat(m[1]) : 0;
      };

      const NUM = '(\\d{1,3}(?:\\.\\d{3})*,\\d{2})';
      const num = m => (m ? parseBrFloat(m[1]) : 0);
      // Algumas corretoras imprimem "rótulo valor" (BB) e outras "valor rótulo" (BTG), com o D/C no meio.
      const valorAntes = /\d,\d{2}\s+Valor\s+l[ií]quido\s+das\s+opera[cç][oõ]es\s+[DC]\b/i.test(normalized) &&
                         !new RegExp('Valor\\s+l[ií]quido\\s+das\\s+opera[cç][oõ]es\\s+' + NUM, 'i').test(normalized);
      const depois = label => num(normalized.match(new RegExp(label + '\\s+(?:[DC]\\s+)?' + NUM, 'i')));
      const antes = label => num(normalized.match(new RegExp(NUM + '\\s+' + label + '(?![A-Za-zÀ-ÿ])', 'i')));
      const liquidoImpresso0 = num(normalized.match(new RegExp('L[ií]quido\\s+para\\s+\\d{2}\\/\\d{2}\\/\\d{4}\\s+(?:[DC]\\s+)?' + NUM, 'i')));

      let valorLiquidoOperacoes, taxaLiquidacao, taxaRegistro, totalCblcBruto, emolumentos, totalBovespa, totalCorretagem;
      if (valorAntes) {
        valorLiquidoOperacoes = antes('Valor\\s+l[ií]quido\\s+das\\s+opera[cç][oõ]es') || matchValAfterLabel(/Valor\s+das\s+opera[cç][oõ]es\s+([\d.,]+)/i);
        taxaLiquidacao = antes('Taxa\\s+de\\s+liquida[cç][aã]o(?:\\s*\\/\\s*CCP)?');
        taxaRegistro = antes('Taxa\\s+de\\s+registro');
        totalCblcBruto = antes('Total\\s+CBLC');
        emolumentos = antes('Emolumentos');
        totalBovespa = antes('Total\\s+Bovespa\\s*\\/\\s*Soma') || emolumentos;
        totalCorretagem = depois('Total\\s+corretagem\\s*\\/\\s*Despesas') || antes('Total\\s+corretagem\\s*\\/\\s*Despesas');
      } else {
        valorLiquidoOperacoes = matchValAfterLabel(/Valor\s+l[ií]quido\s+das\s+opera[cç][oõ]es\s+([\d.,]+)/i) ||
                                matchValAfterLabel(/Valor\s+das\s+opera[cç][oõ]es\s+([\d.,]+)/i);
        taxaLiquidacao = matchValAfterLabel(/Taxa\s+de\s+liquida[cç][aã]o\s+([\d.,]+)/i);
        taxaRegistro = matchValAfterLabel(/Taxa\s+de\s+Registro\s+([\d.,]+)/i);
        totalCblcBruto = matchValAfterLabel(/Total\s+CBLC\s+([\d.,]+)/i);
        emolumentos = matchValAfterLabel(/Emolumentos\s+([\d.,]+)/i);
        totalBovespa = matchValAfterLabel(/Total\s+Bovespa\s*\/\s*Soma\s+([\d.,]+)/i) || emolumentos;
        totalCorretagem = matchValAfterLabel(/Total\s+corretagem\s*\/\s*Despesas\s+([\d.,]+)/i);
      }

      // Taxa CBLC = diferença entre o "Total CBLC" e o "Valor líquido das operações" (inclui outras taxas do bloco,
      // como a de transferência de ativos); sem os totais, usa liquidação + registro.
      let taxaCblcLiquida = taxaLiquidacao + taxaRegistro;
      if (totalCblcBruto > 0 && valorLiquidoOperacoes > 0) {
        const dif = Number(Math.abs(totalCblcBruto - valorLiquidoOperacoes).toFixed(2));
        if (dif > 0 && dif <= valorLiquidoOperacoes * 0.05 + 1 && dif >= taxaCblcLiquida) taxaCblcLiquida = dif;
      }
      const valorLiquidoNota = liquidoImpresso0 || (valorLiquidoOperacoes + taxaCblcLiquida + totalBovespa + totalCorretagem);

      // 4. Extrai linhas de negócios realizados (Ex: BRADESCO PN N1-BBDC4 ou B3 ON NM-B3SA3)
      const operacoesExtraidas = [];
      const regexNegocio = /1-BOVESPA\s+([CV])\s+(VISTA|FRACIONARIO|TERMO|EXERC(?:ICIO)?\s+(?:DE\s+)?OPC(?:AO)?(?:\s+DE)?\s+(?:COMPRA|VENDA)|OPCAO\s+DE\s+COMPRA|OPCAO\s+DE\s+VENDA|OPC\s+COMPRA|OPC\s+VENDA)\s+(.+?)\s+(\d+(?:\.\d{3})*)\s+([\d.,]+)\s+([\d.,]+)\s+[DC]/gi;
      const regexNegocioInvertido = /([CV])\s+VISTA\s+1-BOVESPA\s+(.+?)\s+(\d+(?:\.\d{3})*)\s+([\d.,]+)\s+([\d.,]+)\s+[DC]/gi;

      // Opções: o exercício vira compra/venda do ativo-objeto ao preço de exercício (ex.: CXSEG196E ON -> CXSE3);
      // negociações de opções (prêmio) não são registradas pelo app e são ignoradas com aviso.
      const avisosOperacoes = [], opcoesIgnoradas = [];
      const CLASSES_ACAO = { ON: '3', PN: '4', PNA: '5', PNB: '6', PNC: '7', PND: '8', UNT: '11', UNIT: '11' };
      const ativoObjetoDaOpcao = spec => {
        const m = String(spec).toUpperCase().match(/\b([A-Z]{4})[A-X]\d{1,4}[A-Z]?\b\s*(ON|PNA|PNB|PNC|PND|PN|UNT|UNIT)?/);
        if (!m) return null;
        return { codigo: m[0].trim().split(/\s+/)[0], ticker: m[1] + CLASSES_ACAO[m[2] || 'ON'], classe: m[2] || 'ON' };
      };
      let match;
      while ((match = regexNegocio.exec(normalized)) !== null) {
        const tipoOrdem = match[1].toUpperCase();
        let especificacaoCompleta = match[3].trim();
        const mercado = match[2].toUpperCase().replace(/\s+/g, ' ');
        let tickerDaOpcao = null;
        if (/^EXERC/.test(mercado)) {
          const u = ativoObjetoDaOpcao(especificacaoCompleta);
          if (!u) { opcoesIgnoradas.push(especificacaoCompleta); continue; }
          tickerDaOpcao = u.ticker;
          avisosOperacoes.push(`Exercício da opção ${u.codigo}: registrado como ${tipoOrdem === 'V' ? 'venda' : 'compra'} de ${u.ticker} ao preço de exercício. Confira o ticker.`);
          especificacaoCompleta = `${u.ticker} ${u.classe} (exerc. ${u.codigo})`;
        } else if (/^OPCAO DE|^OPC /.test(mercado)) {
          opcoesIgnoradas.push(especificacaoCompleta); continue;
        }
        const qtd = parseBrFloat(match[4]);
        const precoUnit = parseBrFloat(match[5]);
        const valorOp = parseBrFloat(match[6]);

        // Extração robusta do Ticker a partir da especificação (busca padrão B3 ex: B3SA3, BBDC4, CMIG4)
        let ticker = tickerDaOpcao || 'ATIVO';
        const specUpper = especificacaoCompleta.toUpperCase();
        // Procura padrão específico B3 (4 letras seguidas de 1 a 3 dígitos, podendo terminar com F)
        const explicitTickerMatch = specUpper.match(/\b([A-Z]{4}\d{1,3}F?)\b/);
        if (tickerDaOpcao) {
          // ticker já definido pelo ativo-objeto da opção
        } else if (explicitTickerMatch) {
          ticker = explicitTickerMatch[1].replace(/F$/, '');
        } else {
          // Fallback buscando após hífen ou traço
          const parts = specUpper.split(/[-–]/);
          if (parts.length > 1) {
            const candidate = parts[parts.length - 1].trim().split(/\s+/)[0];
            if (candidate && candidate.length >= 5 && candidate.length <= 6) {
              ticker = candidate.replace(/F$/, '');
            }
          }
        }

        operacoesExtraidas.push({
          ticker,
          especificacao: especificacaoCompleta,
          tipo_ordem: tipoOrdem,
          quantidade: qtd,
          preco_unitario: precoUnit,
          valor_operacao: valorOp
        });
      }

      // Tenta o formato alternativo caso o primeiro não tenha capturado
      if (operacoesExtraidas.length === 0) {
        while ((match = regexNegocioInvertido.exec(normalized)) !== null) {
          const tipoOrdem = match[1].toUpperCase();
          const especificacaoCompleta = match[2].trim();
          const qtd = parseBrFloat(match[3]);
          const precoUnit = parseBrFloat(match[4]);
          const valorOp = parseBrFloat(match[5]);

          let ticker = 'ATIVO';
          const specUpper = especificacaoCompleta.toUpperCase();
          const explicitTickerMatch = specUpper.match(/\b([A-Z]{4}\d{1,3}F?)\b/);
          if (explicitTickerMatch) {
            ticker = explicitTickerMatch[1].replace(/F$/, '');
          } else {
            const parts = specUpper.split(/[-–]/);
            if (parts.length > 1) {
              const candidate = parts[parts.length - 1].trim().split(/\s+/)[0];
              if (candidate && candidate.length >= 5 && candidate.length <= 6) {
                ticker = candidate.replace(/F$/, '');
              }
            }
          }

          operacoesExtraidas.push({
            ticker,
            especificacao: especificacaoCompleta,
            tipo_ordem: tipoOrdem,
            quantidade: qtd,
            preco_unitario: precoUnit,
            valor_operacao: valorOp
          });
        }
      }

      // Sem operações reconhecidas: não inventa dados, apenas avisa (layout de outra corretora, PDF escaneado etc.)
      if (operacoesExtraidas.length === 0) {
        const e = new Error('Nenhuma operação reconhecida na nota');
        e.userMessage = opcoesIgnoradas.length
          ? `A nota ${fileName} só tem operações com opções (prêmio), que o app ainda não registra.`
          : `Layout não reconhecido em ${fileName}. Lance as operações manualmente.`;
        throw e;
      }

      // Conferência automática: compara o que foi lido com os totais impressos na própria nota
      const brl = v => 'R$ ' + v.toFixed(2).replace('.', ',');
      const liquidoImpresso = liquidoImpresso0;
      const saldoOps = operacoesExtraidas.reduce((a, o) => a + (o.tipo_ordem === 'V' ? o.valor_operacao : -o.valor_operacao), 0);
      const taxasTotais = taxaCblcLiquida + totalBovespa + totalCorretagem;
      const avisosConferencia = [];
      avisosOperacoes.forEach(a => avisosConferencia.push(a));
      if (opcoesIgnoradas.length) avisosConferencia.push(`Operações com opções (prêmio) não são registradas pelo app e foram ignoradas: ${opcoesIgnoradas.join(', ')}. Os totais da nota incluem essas operações.`);
      if (valorLiquidoOperacoes > 0 && Math.abs(Math.abs(saldoOps) - valorLiquidoOperacoes) > 0.015) {
        avisosConferencia.push(`As operações lidas somam ${brl(Math.abs(saldoOps))}, mas a nota indica ${brl(valorLiquidoOperacoes)} em "Valor líquido das operações". Alguma operação pode não ter sido lida.`);
      }
      if (liquidoImpresso > 0) {
        const esperado = saldoOps < 0 ? Math.abs(saldoOps) + taxasTotais : Math.abs(saldoOps) - taxasTotais;
        if (Math.abs(esperado - liquidoImpresso) > 0.015) {
          avisosConferencia.push(`Operações e taxas lidas resultam em ${brl(esperado)}, mas o "Líquido" impresso na nota é ${brl(liquidoImpresso)}. Verifique taxas ou outras despesas (ex.: IRRF).`);
        }
      }
      if (valorLiquidoOperacoes === 0 && liquidoImpresso === 0) {
        avisosConferencia.push('Não foi possível localizar os totais da nota para conferir os valores lidos.');
      }

      // Identificação da corretora (o CNPJ é o dado mais confiável; o nome vem do cabeçalho da nota)
      const CORRETORAS_CONHECIDAS = { '24.933.830/0001-30': 'BB Banco de Investimento S.A.', '43.815.158/0001-22': 'BTG Pactual CTVM S.A.' };   // notas já validadas
      const cnpjM = normalized.match(/C\.?N\.?P\.?J\.?\s*:\s*(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/i);
      const corretoraCnpj = cnpjM ? cnpjM[1] : '';
      const extrairNomeCorretora = () => {
        const SUF = /^(S\.?\/?A\.?|LTDA\.?|CCTVM|DTVM|CTVM|DTCVM)$/i, UFS = /^(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$/;
        const limpa = t => t.replace(/[,;]$/, '');
        const toks = normalized.split(' ');
        for (let i = 1; i < toks.length; i++) {
          if (!SUF.test(limpa(toks[i]))) continue;
          let fim = i; while (fim + 1 < toks.length && SUF.test(limpa(toks[fim + 1]))) fim++;
          const nome = [];
          for (let j = i - 1; j >= 0 && nome.length < 8; j--) {
            const t = toks[j];
            if (!/[A-Za-zÀ-ÿ]/.test(t) || /:$/.test(t) || UFS.test(t)) break;   // número, rótulo ("Internet:") ou sigla de estado
            nome.unshift(t);
          }
          if (nome.length) return nome.concat(toks.slice(i, fim + 1)).join(' ');
        }
        return '';
      };
      const corretoraNome = CORRETORAS_CONHECIDAS[corretoraCnpj] || extrairNomeCorretora().replace(/^NOTA\s+DE\s+(?:CORRETAGEM|NEGOCIA[ÇC][AÃ]O)\s+/i, '').trim();
      if (!corretoraCnpj && !corretoraNome) {
        avisosConferencia.push('Não foi possível identificar a corretora desta nota.');
      } else if (corretoraCnpj && !CORRETORAS_CONHECIDAS[corretoraCnpj]) {
        avisosConferencia.push('Corretora ainda não validada pelo app (testado com BB e BTG Pactual). Confira todos os valores.');
      }

      // Rateio proporcional das taxas da nota para cada operação
      const somaOperacoes = operacoesExtraidas.reduce((acc, op) => acc + op.valor_operacao, 0) || 1;
      const operacoesComRateio = operacoesExtraidas.map(op => {
        const peso = op.valor_operacao / somaOperacoes;
        return {
          ...op,
          taxa_cblc: Number((taxaCblcLiquida * peso).toFixed(2)),
          taxa_bovespa: Number((totalBovespa * peso).toFixed(2)),
          taxa_corretagem: Number((totalCorretagem * peso).toFixed(2))
        };
      });

      [['taxa_cblc', taxaCblcLiquida], ['taxa_bovespa', totalBovespa], ['taxa_corretagem', totalCorretagem]].forEach(([k, total]) => {
        const sobra = Number((total - operacoesComRateio.reduce((a, o) => a + o[k], 0)).toFixed(2));
        if (sobra !== 0 && Math.abs(sobra) <= 0.05) {
          const maior = operacoesComRateio.reduce((m, o) => (o.valor_operacao > m.valor_operacao ? o : m), operacoesComRateio[0]);
          maior[k] = Number((maior[k] + sobra).toFixed(2));
        }
      });

      return {
        numero_controle: numeroControle,
        data_pregao: dataPregao,
        valor_operacoes: valorLiquidoOperacoes || somaOperacoes,
        total_cblc_bruto: totalCblcBruto || (somaOperacoes + taxaCblcLiquida),
        taxa_cblc: taxaCblcLiquida,
        taxa_bovespa: totalBovespa,
        taxa_corretagem: totalCorretagem,
        valor_liquido_nota: valorLiquidoNota,
        nome_arquivo: fileName,
        arquivo_base64: base64Pdf,
        avisos_conferencia: avisosConferencia,
        corretora_nome: corretoraNome,
        corretora_cnpj: corretoraCnpj,
        operacoes: operacoesComRateio
      };
    }


// Compatibilidade com os handlers clássicos definidos no index.html.
globalThis.parseSinacorNote = parseSinacorNote;

// Ponte de compatibilidade: mantém os nomes públicos acessíveis ao HTML e aos demais módulos.
Object.defineProperty(globalThis, "parseSinacorNote", { configurable: true, enumerable: true, get: () => parseSinacorNote, set: value => { parseSinacorNote = value; } });
