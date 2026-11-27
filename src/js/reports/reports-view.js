// Relatórios auxiliares (IRPF, rendimentos e operações) e exportação para PDF e Excel.

import { makeSheetXml, zipStore } from './excel-export.js';
import { db } from '../core/state.js';
import { queryAll } from '../core/database.js';
import { PROV_TIPOS, isoToBR } from '../dividends/proventos.js';
import { escapeSavedNoteText } from '../notes/notes-manager.js';
import { toISODate } from '../portfolio/positions.js';
import { showToast } from '../ui/navigation.js';

// =========================================================================
// RELATÓRIOS — base histórica por custo médio, independente da cotação atual
// =========================================================================
let reportView = 'irpf';
let reportCache = null;
const reportBRL = v => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const reportQty = v => (Number(v) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 8 });
function initReportYearOptions() {
  const sel = document.getElementById('reportCalendarYear'); if (!sel) return;
  const current = new Date().getFullYear();
  let firstYear = current;
  try {
    const firstPurchase = queryAll("SELECT data_operacao FROM operacoes WHERE tipo_ordem = 'C'")
      .map(r => toISODate(r.data_operacao)).filter(Boolean).sort()[0];
    if (firstPurchase) firstYear = Math.min(current, Number(firstPurchase.slice(0, 4)) || current);
  } catch (e) { console.warn('Não foi possível determinar a primeira compra para o filtro do IRPF:', e); }
  const years = [];
  for (let y = current; y >= firstYear; y--) years.push(y);
  const selected = sel.value && years.includes(Number(sel.value)) ? Number(sel.value) : current;
  sel.innerHTML = years.map(y => y === current
    ? `<option value="${y}">${y} — Exercício ${y+1} (Prévia)</option>`
    : `<option value="${y}">${y} — Exercício ${y+1}</option>`).join('');
  sel.value = String(selected);
}
function buildReportDataset(year) {
  const ops = queryAll('SELECT id, data_operacao, ticker, especificacao, tipo_ordem, quantidade, preco_unitario, valor_operacao, taxa_cblc, taxa_bovespa, taxa_corretagem FROM operacoes').sort((a,b)=>toISODate(a.data_operacao).localeCompare(toISODate(b.data_operacao)) || Number(a.id)-Number(b.id));
  const start = `${year}-01-01`, end = `${year}-12-31`, prevEnd = `${year-1}-12-31`;
  const state = Object.create(null), sales = [], operations = [], annualByTicker = Object.create(null);
  const ensure = t => state[t] || (state[t] = {ticker:t, especificacao:t, qty:0, cost:0, realized:0});
  const snapshot = () => Object.values(state).filter(x => x.qty > 1e-10).map(x => ({ticker:x.ticker, especificacao:x.especificacao, quantidade:x.qty, custo:x.cost, precoMedio:x.qty ? x.cost/x.qty : 0})).sort((a,b)=>a.ticker.localeCompare(b.ticker));
  let prev = [], current = [];
  for (const op of ops) {
    const d = toISODate(op.data_operacao); if (!d || d > end) continue;
    const ticker = String(op.ticker || '').toUpperCase().trim(); if (!ticker) continue;
    const item = ensure(ticker); if ((op.especificacao || '').length > item.especificacao.length) item.especificacao = op.especificacao;
    const qty = Math.max(0, Number(op.quantidade)||0), val = Number(op.valor_operacao) || qty*(Number(op.preco_unitario)||0);
    const fees = (Number(op.taxa_cblc)||0)+(Number(op.taxa_bovespa)||0)+(Number(op.taxa_corretagem)||0);
    let result = 0;
    if (op.tipo_ordem === 'C') { item.qty += qty; item.cost += val + fees; }
    else if (op.tipo_ordem === 'V') {
      const sold = Math.min(qty, item.qty), costSold = item.qty > 0 ? item.cost*(sold/item.qty) : 0;
      const net = Math.max(0, val - fees), revenue = qty > 0 ? net*(sold/qty) : 0;
      result = revenue - costSold;
      item.qty = Math.max(0, item.qty-sold); item.cost = Math.max(0, item.cost-costSold); item.realized += result;
      if (d >= start) {
        const row = annualByTicker[ticker] || (annualByTicker[ticker] = {ticker, compras:0, vendas:0, taxas:0, resultado:0, quantidadeVendida:0, operacoes:0});
        row.vendas += revenue; row.resultado += result; row.quantidadeVendida += sold; row.operacoes++;
        sales.push({data:d, ticker, quantidade:sold, vendaLiquida:revenue, custoBaixado:costSold, resultado:result});
      }
    }
    if (d >= start && d <= end) operations.push({data:d,ticker,tipo:op.tipo_ordem==='C'?'Compra':'Venda',quantidade:qty,valor:val,taxas:fees,resultado:op.tipo_ordem==='V'?result:null});
    if (d < start) { /* mantém custo histórico anterior */ }
    else if (d <= end) {
      const row = annualByTicker[ticker] || (annualByTicker[ticker] = {ticker, compras:0, vendas:0, taxas:0, resultado:0, quantidadeVendida:0, operacoes:0});
      if (op.tipo_ordem === 'C') { row.compras += val + fees; row.taxas += fees; row.operacoes++; }
      else if (op.tipo_ordem === 'V') row.taxas += fees;
    }
  }
  // O snapshot anterior precisa ser reconstruído separadamente até 31/12 do ano anterior.
  const prevState = Object.create(null);
  for (const op of ops) {
    const d = toISODate(op.data_operacao); if (!d || d > prevEnd) continue;
    const t = String(op.ticker||'').toUpperCase().trim(); if (!t) continue;
    const x = prevState[t] || (prevState[t]={ticker:t, especificacao:op.especificacao||t, qty:0, cost:0});
    const q=Math.max(0,Number(op.quantidade)||0), v=Number(op.valor_operacao)||(q*(Number(op.preco_unitario)||0));
    const f=(Number(op.taxa_cblc)||0)+(Number(op.taxa_bovespa)||0)+(Number(op.taxa_corretagem)||0);
    if(op.tipo_ordem==='C'){x.qty+=q;x.cost+=v+f;} else if(op.tipo_ordem==='V'){const sold=Math.min(q,x.qty), c=x.qty?x.cost*(sold/x.qty):0;x.qty=Math.max(0,x.qty-sold);x.cost=Math.max(0,x.cost-c);}
  }
  prev = Object.values(prevState).filter(x=>x.qty>1e-10).map(x=>({ticker:x.ticker,especificacao:x.especificacao,quantidade:x.qty,custo:x.cost,precoMedio:x.qty?x.cost/x.qty:0})).sort((a,b)=>a.ticker.localeCompare(b.ticker));
  current = snapshot();
  const provs = queryAll('SELECT ticker, tipo, data_pagamento, quantidade, valor_bruto, imposto, valor_liquido FROM proventos WHERE data_pagamento >= ? AND data_pagamento <= ? ORDER BY data_pagamento, id', [start,end]);
  const ownedTickers = new Set(ops.map(o=>String(o.ticker||'').toUpperCase().trim()));
  const rendimentos = provs.filter(p=>ownedTickers.has(String(p.ticker||'').toUpperCase().trim()));
  const incomeByTicker = Object.create(null);
  rendimentos.forEach(p=>{const t=String(p.ticker||'').toUpperCase();const x=incomeByTicker[t]||(incomeByTicker[t]={ticker:t,bruto:0,imposto:0,liquido:0,tipos:Object.create(null)});x.bruto+=Number(p.valor_bruto)||0;x.imposto+=Number(p.imposto)||0;x.liquido+=Number(p.valor_liquido)||0;const k=String(p.tipo||'OUTRO').toUpperCase();x.tipos[k]=(x.tipos[k]||0)+(Number(p.valor_bruto)||0);});
  return {year, prevYear:year-1, prev, current, sales, operations, annualByTicker:Object.values(annualByTicker).sort((a,b)=>a.ticker.localeCompare(b.ticker)), rendimentos, incomeByTicker:Object.values(incomeByTicker).sort((a,b)=>a.ticker.localeCompare(b.ticker)), totals:{custoAnterior:prev.reduce((a,x)=>a+x.custo,0),custoAtual:current.reduce((a,x)=>a+x.custo,0),proventosBrutos:rendimentos.reduce((a,x)=>a+(Number(x.valor_bruto)||0),0),impostoRetido:rendimentos.reduce((a,x)=>a+(Number(x.imposto)||0),0),proventosLiquidos:rendimentos.reduce((a,x)=>a+(Number(x.valor_liquido)||0),0),vendas:sales.reduce((a,x)=>a+x.vendaLiquida,0),resultado:sales.reduce((a,x)=>a+x.resultado,0)}};
}
function reportSummaryCard(label,value,sub='') { return `<div class="glass-card rounded-xl p-3 min-w-0"><span class="block text-[10px] leading-tight text-slate-400">${label}</span><strong class="block mt-1 text-sm font-bold font-mono text-white break-words">${value}</strong>${sub?`<span class="block mt-1 text-[10px] text-slate-500">${sub}</span>`:''}</div>`; }
function reportEmpty(msg) { return `<div class="glass-card rounded-2xl p-5 text-center text-xs text-slate-400">${msg}</div>`; }
function renderReportIRPF(d) {
  const union = new Map(); [...d.prev,...d.current].forEach(x=>{const v=union.get(x.ticker)||{ticker:x.ticker,especificacao:x.especificacao,prev:0,now:0,prevQty:0,nowQty:0};const a=d.prev.find(z=>z.ticker===x.ticker),b=d.current.find(z=>z.ticker===x.ticker);v.prev=a?.custo||0;v.now=b?.custo||0;v.prevQty=a?.quantidade||0;v.nowQty=b?.quantidade||0;union.set(x.ticker,v);});
  const rows=[...union.values()].sort((a,b)=>a.ticker.localeCompare(b.ticker));
  return `<div class="grid grid-cols-2 gap-2">${reportSummaryCard(`Custo em 31/12/${d.prevYear}`,reportBRL(d.totals.custoAnterior),'Custo de aquisição estimado')}${reportSummaryCard(`Custo em 31/12/${d.year}`,reportBRL(d.totals.custoAtual),'Custo de aquisição estimado')}</div>
    <div class="flex items-center justify-between gap-2 pt-1"><h2 class="text-sm font-bold text-white">Bens e Direitos — posição por ativo</h2><span class="text-[10px] text-slate-500">${rows.length} ativos</span></div>
    ${rows.length?rows.map(x=>`<article class="glass-card rounded-xl p-3 space-y-2"><div class="flex items-start justify-between gap-2"><div class="min-w-0"><strong class="text-sm text-white">${escapeSavedNoteText(x.ticker)}</strong><p class="text-[10px] text-slate-500 truncate">${escapeSavedNoteText(x.especificacao||'Ativo negociado em bolsa')}</p></div><span class="text-[10px] text-slate-400 shrink-0">Custo</span></div><div class="grid grid-cols-2 gap-2"><div><span class="text-[10px] text-slate-500">31/12/${d.prevYear}</span><strong class="block text-xs font-mono text-slate-200">${reportBRL(x.prev)}</strong><span class="block text-[10px] text-slate-500">Qtd. ${reportQty(x.prevQty)}</span><span class="block text-[10px] text-slate-400">Preço médio: ${x.prevQty>0?reportBRL(x.prev/x.prevQty):'—'}</span></div><div><span class="text-[10px] text-slate-500">31/12/${d.year}</span><strong class="block text-xs font-mono text-emerald-300">${reportBRL(x.now)}</strong><span class="block text-[10px] text-slate-500">Qtd. ${reportQty(x.nowQty)}</span><span class="block text-[10px] text-slate-400">Preço médio: ${x.nowQty>0?reportBRL(x.now/x.nowQty):'—'}</span></div></div></article>`).join(''):reportEmpty('Nenhuma posição encontrada para os dois encerramentos.')}
    <div class="rounded-xl border border-slate-800 p-3 text-[11px] leading-relaxed text-slate-400">Os valores apresentados são custo de aquisição calculado a partir das compras, taxas e baixas por preço médio. Não são cotação nem valor de mercado em 31/12. O Ledgerly ainda não armazena CNPJ do emissor nem classificação fiscal completa para preencher automaticamente todos os campos da ficha da Receita.</div>`;
}
function renderReportIncome(d) {
  const rows=d.incomeByTicker;
  return `<div class="grid grid-cols-2 gap-2">${reportSummaryCard('Rendimentos brutos',reportBRL(d.totals.proventosBrutos))}${reportSummaryCard('IR retido informado',reportBRL(d.totals.impostoRetido))}${reportSummaryCard('Valor líquido',reportBRL(d.totals.proventosLiquidos))}${reportSummaryCard('Lançamentos',String(d.rendimentos.length))}</div>
  <h2 class="text-sm font-bold text-white pt-1">Rendimentos por ativo</h2>
  ${rows.length?rows.map(x=>`<article class="glass-card rounded-xl p-3"><div class="flex justify-between gap-2"><strong class="text-sm text-white">${escapeSavedNoteText(x.ticker)}</strong><strong class="text-xs font-mono text-emerald-300">${reportBRL(x.bruto)}</strong></div><div class="grid grid-cols-2 gap-2 mt-2 text-[10px] text-slate-400"><span>IR retido: ${reportBRL(x.imposto)}</span><span>Líquido: ${reportBRL(x.liquido)}</span></div><p class="text-[10px] text-slate-500 mt-1">${Object.entries(x.tipos).map(([k,v])=>`${escapeSavedNoteText(PROV_TIPOS[k]||k)}: ${reportBRL(v)}`).join(' · ')}</p></article>`).join(''):reportEmpty('Nenhum provento cadastrado no ano selecionado.')}`;
}
function renderReportOperations(d) {
  const rows=d.annualByTicker;
  return `<div class="grid grid-cols-2 gap-2">${reportSummaryCard('Vendas líquidas registradas',reportBRL(d.totals.vendas))}${reportSummaryCard('Resultado estimado',reportBRL(d.totals.resultado),'Preço médio; não é cálculo de IR')}</div>
  <h2 class="text-sm font-bold text-white pt-1">Resumo por ativo</h2>
  ${rows.length?rows.map(x=>`<article class="glass-card rounded-xl p-3 space-y-2"><div class="flex justify-between gap-2"><strong class="text-sm text-white">${escapeSavedNoteText(x.ticker)}</strong><span class="text-[10px] text-slate-500">${x.operacoes} operações</span></div><div class="grid grid-cols-2 gap-2 text-[10px]"><span class="text-slate-400">Compras: <b class="text-slate-200">${reportBRL(x.compras)}</b></span><span class="text-slate-400">Vendas: <b class="text-slate-200">${reportBRL(x.vendas)}</b></span><span class="text-slate-400">Taxas: <b class="text-slate-200">${reportBRL(x.taxas)}</b></span><span class="text-slate-400">Resultado: <b class="${x.resultado>=0?'text-emerald-300':'text-rose-300'}">${reportBRL(x.resultado)}</b></span></div></article>`).join(''):reportEmpty('Nenhuma operação registrada no ano selecionado.')}
  <p class="text-[10px] leading-relaxed text-slate-500">Resultado estimado por preço médio ponderado e taxas cadastradas. Não separa day trade, mercado à vista, ETF, FII ou outras regras de tributação e não calcula DARF ou imposto devido.</p>`;
}
function setReportView(view) { reportView=['irpf','rendimentos','operacoes'].includes(view)?view:'irpf'; renderReports(); }
export function renderReports() {
  if (!db) return;
  initReportYearOptions();
  const year=Number(document.getElementById('reportCalendarYear')?.value)||new Date().getFullYear()-1;
  reportCache=buildReportDataset(year);
  const root=document.getElementById('reportsContent'); if(!root)return;
  root.innerHTML=reportView==='rendimentos'?renderReportIncome(reportCache):reportView==='operacoes'?renderReportOperations(reportCache):renderReportIRPF(reportCache);
  ['irpf','rendimentos','operacoes'].forEach(v=>{const b=document.getElementById('reportTab-'+v);if(!b)return;const on=v===reportView;b.className='rounded-xl py-2.5 px-1 text-[11px] font-bold border '+(on?'bg-emerald-500/15 text-emerald-300 border-emerald-500/30':'bg-slate-900 text-slate-400 border-slate-800');});
  lucide.createIcons();
}
function getReportExportData() {
  const year=Number(document.getElementById('reportCalendarYear')?.value)||new Date().getFullYear()-1;
  return buildReportDataset(year);
}
function exportReportsPDF() {
  const d=getReportExportData(), win=window.open('','_blank');
  if(!win){showToast('O navegador bloqueou a janela de impressão. Permita pop-ups para exportar o PDF.','error');return;}
  const holdings=new Map();[...d.prev,...d.current].forEach(x=>holdings.set(x.ticker,{ticker:x.ticker,prev:d.prev.find(z=>z.ticker===x.ticker),now:d.current.find(z=>z.ticker===x.ticker)}));
  const money=v=>reportBRL(v), esc=escapeSavedNoteText;
  const html=`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ledgerly Pro — Relatório ${d.year}</title><style>body{font:12px Arial,sans-serif;color:#172033;margin:24px}h1{font-size:20px}h2{font-size:15px;margin:22px 0 8px}p{line-height:1.45}.muted{color:#596579;font-size:10px}@page{size:A4 landscape}table{width:100%;border-collapse:collapse;margin:8px 0 16px}th,td{border:1px solid #d7dce5;padding:6px;text-align:left;font-size:10px}th{background:#eef1f6}.num{text-align:right}.note{background:#f5f6f8;padding:10px;border-left:3px solid #d39b32}@media print{body{margin:12mm}h2{break-after:avoid}tr{break-inside:avoid}}</style></head><body><h1>Ledgerly Pro — Relatório auxiliar para IRPF</h1><p>Ano-calendário ${d.year} · Exercício ${d.year+1}</p><h2>Bens e Direitos — custo de aquisição</h2><table><thead><tr><th>Ativo</th><th>Quantidade em 31/12/${d.prevYear}</th><th>Preço médio</th><th>Custo em 31/12/${d.prevYear}</th><th>Quantidade em 31/12/${d.year}</th><th>Preço médio</th><th>Custo em 31/12/${d.year}</th></tr></thead><tbody>${[...holdings.values()].map(x=>`<tr><td>${esc(x.ticker)}</td><td>${x.prev?reportQty(x.prev.quantidade):'0'}</td><td class="num">${x.prev&&x.prev.quantidade>0?money(x.prev.custo/x.prev.quantidade):'—'}</td><td class="num">${money(x.prev?.custo||0)}</td><td>${x.now?reportQty(x.now.quantidade):'0'}</td><td class="num">${x.now&&x.now.quantidade>0?money(x.now.custo/x.now.quantidade):'—'}</td><td class="num">${money(x.now?.custo||0)}</td></tr>`).join('')}</tbody></table><h2>Rendimentos registrados</h2><p>Bruto: ${money(d.totals.proventosBrutos)} · IR retido cadastrado: ${money(d.totals.impostoRetido)} · Líquido: ${money(d.totals.proventosLiquidos)}</p><table><thead><tr><th>Ativo</th><th>Tipo</th><th>Pagamento</th><th class="num">Bruto</th><th class="num">IR</th><th class="num">Líquido</th></tr></thead><tbody>${d.rendimentos.map(x=>`<tr><td>${esc(x.ticker)}</td><td>${esc(PROV_TIPOS[x.tipo]||x.tipo)}</td><td>${esc(isoToBR(x.data_pagamento))}</td><td class="num">${money(x.valor_bruto)}</td><td class="num">${money(x.imposto)}</td><td class="num">${money(x.valor_liquido)}</td></tr>`).join('')}</tbody></table><h2>Operações do ano</h2><p>Vendas líquidas registradas: ${money(d.totals.vendas)} · Resultado estimado: ${money(d.totals.resultado)}</p><table><thead><tr><th>Data</th><th>Tipo</th><th>Ativo</th><th>Quantidade</th><th class="num">Valor bruto</th><th class="num">Taxas</th><th class="num">Resultado venda</th></tr></thead><tbody>${d.operations.map(x=>`<tr><td>${esc(isoToBR(x.data))}</td><td>${x.tipo}</td><td>${esc(x.ticker)}</td><td>${reportQty(x.quantidade)}</td><td class="num">${money(x.valor)}</td><td class="num">${money(x.taxas)}</td><td class="num">${x.resultado===null?'—':money(x.resultado)}</td></tr>`).join('')}</tbody></table><p class="note">Relatório auxiliar baseado nos dados informados no Ledgerly Pro. Não substitui a declaração oficial. O preço médio é exibido como informação auxiliar; o valor patrimonial informado em Bens e Direitos é o custo total de aquisição estimado, não a cotação histórica. Confira informes, CNPJ, classificação fiscal, eventos societários e regras vigentes.</p><p class="muted">Gerado em ${new Date().toLocaleString('pt-BR')}.</p></body></html>`;
  win.document.open();win.document.write(html);win.document.close();setTimeout(()=>{try{win.focus();win.print();}catch(e){showToast('Não foi possível abrir a impressão neste navegador.','error');}},350);
}
function exportReportsExcel(){
  const d=getReportExportData(),holdings=new Map();[...d.prev,...d.current].forEach(x=>holdings.set(x.ticker,{ticker:x.ticker,prev:d.prev.find(z=>z.ticker===x.ticker),now:d.current.find(z=>z.ticker===x.ticker)}));
  const assets=[['Ativo','Descrição','Quantidade 31/12/'+d.prevYear,'Preço médio 31/12/'+d.prevYear,'Custo 31/12/'+d.prevYear,'Quantidade 31/12/'+d.year,'Preço médio 31/12/'+d.year,'Custo 31/12/'+d.year],...[...holdings.values()].map(x=>[x.ticker,x.now?.especificacao||x.prev?.especificacao||x.ticker,x.prev?.quantidade||0,x.prev&&x.prev.quantidade>0?x.prev.custo/x.prev.quantidade:'',x.prev?.custo||0,x.now?.quantidade||0,x.now&&x.now.quantidade>0?x.now.custo/x.now.quantidade:'',x.now?.custo||0])];
  const income=[['Data de pagamento','Ativo','Tipo','Valor bruto','Imposto retido','Valor líquido'],...d.rendimentos.map(x=>[x.data_pagamento,x.ticker,PROV_TIPOS[x.tipo]||x.tipo,Number(x.valor_bruto)||0,Number(x.imposto)||0,Number(x.valor_liquido)||0])];
  const operations=[['Data','Tipo','Ativo','Quantidade','Valor bruto','Taxas','Resultado estimado da venda'],...d.operations.map(x=>[x.data,x.tipo,x.ticker,x.quantidade,x.valor,x.taxas,x.resultado===null?'':x.resultado])];
  const files=[{name:'[Content_Types].xml',data:'<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'},{name:'_rels/.rels',data:'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'},{name:'xl/workbook.xml',data:'<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Bens e Direitos" sheetId="1" r:id="rId1"/><sheet name="Rendimentos" sheetId="2" r:id="rId2"/><sheet name="Operações" sheetId="3" r:id="rId3"/></sheets></workbook>'},{name:'xl/_rels/workbook.xml.rels',data:'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/></Relationships>'},{name:'xl/worksheets/sheet1.xml',data:makeSheetXml(assets)},{name:'xl/worksheets/sheet2.xml',data:makeSheetXml(income)},{name:'xl/worksheets/sheet3.xml',data:makeSheetXml(operations)}];
  const blob=zipStore(files),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`Ledgerly_IRPF_${d.year}.xlsx`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);showToast('Planilha Excel gerada.','success');
}

// Compatibilidade apenas para handlers inline no HTML/templates.
Object.assign(globalThis, {
  exportReportsExcel,
  exportReportsPDF,
  renderReports,
  setReportView
});
