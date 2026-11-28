// Leitor 100% local de arquivos de posição de custódia (CSV e Excel .xlsx) com detecção automática de colunas.
// Sem dependências externas: usa DecompressionStream('deflate-raw') e DOMParser nativos do navegador.

const TICKER_EXACT_RE = /^[A-Z][A-Z0-9]{3}\d{1,2}$/;
const TICKER_START_RE = /^([A-Z][A-Z0-9]{3}\d{1,2})F?(?:\s*[-–—:/]|\s|$)/;
const TICKER_ANY_RE = /\b([A-Z][A-Z0-9]{3}\d{1,2})F?\b/;

function normHeader(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeTicker(raw, allowSearch = false) {
  const s = String(raw ?? '').trim().toUpperCase();
  if (!s) return '';
  if (/^(TOTAL|SUBTOTAL|CONSOLIDADO|RESUMO)\b/.test(s)) return '';

  const compact = s.replace(/\s+/g, '');
  const noFrac = compact.endsWith('F') && compact.length >= 6 ? compact.slice(0, -1) : compact;
  if (TICKER_EXACT_RE.test(noFrac)) return noFrac;

  const mStart = s.match(TICKER_START_RE);
  if (mStart) return mStart[1];

  if (allowSearch) {
    const mAny = s.match(TICKER_ANY_RE);
    if (mAny) return mAny[1];
  }
  return '';
}

function parseCellNumber(cell) {
  if (!cell) return NaN;
  if (cell.isNumber) {
    const n = Number(cell.raw);
    return Number.isFinite(n) ? n : NaN;
  }
  const s = String(cell.raw ?? '').replace(/R\$/gi, '').replace(/[\s\u00A0]/g, '').trim();
  if (!s || s === '-' || s === '—') return NaN;
  const hasDot = s.includes('.');
  const hasComma = s.includes(',');
  let normalized = s;
  if (hasDot && hasComma) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      normalized = s.replace(/\./g, '').replace(',', '.');
    } else {
      normalized = s.replace(/,/g, '');
    }
  } else if (hasComma) {
    normalized = s.replace(',', '.');
  } else if (hasDot) {
    normalized = s.replace(/\.(?=\d{3}(?:\.|$))/g, '');
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : NaN;
}

// =========================================================================
// LEITOR CSV (UTF-8 / Windows-1252, separador automático ; , ou TAB)
// =========================================================================
function decodeTextBuffer(buffer) {
  let text = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
  if (text.includes('\uFFFD')) {
    try {
      text = new TextDecoder('windows-1252').decode(buffer);
    } catch (_) {}
  }
  return text.replace(/^\uFEFF/, '');
}

function detectCsvDelimiter(text) {
  const sampleLines = text.split(/\r?\n/).filter(l => l.trim()).slice(0, 20);
  const candidates = [';', ',', '\t'];
  let best = ';';
  let bestScore = -1;

  for (const delim of candidates) {
    const counts = [];
    for (const line of sampleLines) {
      let inQuotes = false;
      let count = 0;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQuotes && line[i + 1] === '"') { i++; continue; }
          inQuotes = !inQuotes;
        } else if (ch === delim && !inQuotes) {
          count++;
        }
      }
      if (count > 0) counts.push(count);
    }
    if (!counts.length) continue;
    const freq = new Map();
    counts.forEach(c => freq.set(c, (freq.get(c) || 0) + 1));
    const maxConsistent = Math.max(...freq.values());
    const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
    const score = maxConsistent * 10 + Math.min(avg, 20);
    if (score > bestScore) {
      bestScore = score;
      best = delim;
    }
  }
  return best;
}

function parseCsvRows(text) {
  const delim = detectCsvDelimiter(text);
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      row.push({ raw: field.trim(), isNumber: false });
      field = '';
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && next === '\n') i++;
      row.push({ raw: field.trim(), isNumber: false });
      if (row.some(c => c.raw !== '')) rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push({ raw: field.trim(), isNumber: false });
    if (row.some(c => c.raw !== '')) rows.push(row);
  }
  return rows;
}

// =========================================================================
// LEITOR XLSX NATIVO (ZIP + deflate-raw + DOMParser XML)
// =========================================================================
async function inflateRawBytes(bytes) {
  const Stream = globalThis.DecompressionStream;
  if (typeof Stream === 'undefined') {
    throw new Error('Este navegador não suporta leitura nativa de arquivos .xlsx. Exporte a posição em CSV e importe novamente.');
  }
  const stream = new Stream('deflate-raw');
  const writer = stream.writable.getWriter();
  const outputPromise = new Response(stream.readable).arrayBuffer();
  try {
    await writer.write(bytes);
    await writer.close();
    return new Uint8Array(await outputPromise);
  } catch (err) {
    try { await writer.abort(err); } catch (_) {}
    throw err;
  }
}

async function unzipXlsx(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);
  if (bytes.length < 22) throw new Error('Arquivo Excel (.xlsx) inválido ou corrompido.');

  const minEocd = Math.max(0, bytes.length - 65557);
  let eocdOffset = -1;
  for (let i = bytes.length - 22; i >= minEocd; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error('Arquivo Excel (.xlsx) inválido: estrutura ZIP não encontrada.');

  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const cdOffset = view.getUint32(eocdOffset + 16, true);
  const decoder = new TextDecoder('utf-8');
  const entries = new Map();

  let pos = cdOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (pos + 46 > bytes.length || view.getUint32(pos, true) !== 0x02014b50) break;
    const method = view.getUint16(pos + 10, true);
    const compSize = view.getUint32(pos + 20, true);
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    const localOffset = view.getUint32(pos + 42, true);
    const name = decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameLen));
    pos += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith('/')) continue;
    if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== 0x04034b50) continue;
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const rawSlice = bytes.subarray(dataStart, dataStart + compSize);

    entries.set(name, { method, rawSlice });
  }

  return {
    async readText(path) {
      const normalized = path.replace(/^\/+/, '');
      const entry = entries.get(normalized);
      if (!entry) return null;
      let content;
      if (entry.method === 0) content = entry.rawSlice;
      else if (entry.method === 8) content = await inflateRawBytes(entry.rawSlice);
      else throw new Error(`Método de compressão ZIP não suportado (${entry.method}).`);
      return decoder.decode(content);
    },
    listPaths() {
      return Array.from(entries.keys());
    }
  };
}

function colLettersToIndex(letters) {
  let idx = 0;
  for (let i = 0; i < letters.length; i++) {
    idx = idx * 26 + (letters.charCodeAt(i) - 64);
  }
  return idx - 1;
}

function parseXml(xmlText) {
  return new DOMParser().parseFromString(xmlText, 'application/xml');
}

function parseSharedStrings(xmlText) {
  if (!xmlText) return [];
  const doc = parseXml(xmlText);
  const items = doc.getElementsByTagName('si');
  const out = [];
  for (let i = 0; i < items.length; i++) {
    const texts = items[i].getElementsByTagName('t');
    let full = '';
    for (let j = 0; j < texts.length; j++) {
      full += texts[j].textContent || '';
    }
    out.push(full);
  }
  return out;
}

function parseWorksheetRows(xmlText, sharedStrings) {
  const doc = parseXml(xmlText);
  const rowNodes = doc.getElementsByTagName('row');
  const rows = [];

  for (let r = 0; r < rowNodes.length; r++) {
    const cellNodes = rowNodes[r].getElementsByTagName('c');
    const row = [];
    let seqCol = 0;
    for (let c = 0; c < cellNodes.length; c++) {
      const cell = cellNodes[c];
      const ref = cell.getAttribute('r') || '';
      const colMatch = ref.match(/^([A-Z]+)/i);
      const colIdx = colMatch ? colLettersToIndex(colMatch[1].toUpperCase()) : seqCol;
      seqCol = colIdx + 1;

      const type = cell.getAttribute('t') || '';
      let raw = '';
      let isNumber = false;

      if (type === 's') {
        const vNode = cell.getElementsByTagName('v')[0];
        const idx = vNode ? parseInt(vNode.textContent || '', 10) : -1;
        raw = (idx >= 0 && idx < sharedStrings.length) ? sharedStrings[idx] : '';
      } else if (type === 'inlineStr') {
        const tNodes = cell.getElementsByTagName('t');
        for (let t = 0; t < tNodes.length; t++) raw += tNodes[t].textContent || '';
      } else if (type === 'str' || type === 'e') {
        const vNode = cell.getElementsByTagName('v')[0];
        raw = vNode ? (vNode.textContent || '') : '';
      } else if (type === 'b') {
        const vNode = cell.getElementsByTagName('v')[0];
        raw = vNode && vNode.textContent === '1' ? 'TRUE' : 'FALSE';
      } else {
        const vNode = cell.getElementsByTagName('v')[0];
        if (vNode && vNode.textContent !== '') {
          raw = vNode.textContent;
          isNumber = true;
        }
      }

      row[colIdx] = { raw: typeof raw === 'string' ? raw.trim() : raw, isNumber };
    }
    if (row.some(cell => cell && String(cell.raw ?? '').trim() !== '')) {
      rows.push(row);
    }
  }
  return rows;
}

async function extractXlsxSheets(arrayBuffer) {
  const zip = await unzipXlsx(arrayBuffer);
  const sharedStrings = parseSharedStrings(await zip.readText('xl/sharedStrings.xml'));
  const wbXml = await zip.readText('xl/workbook.xml');
  const relsXml = await zip.readText('xl/_rels/workbook.xml.rels');

  const sheets = [];
  if (wbXml && relsXml) {
    const relMap = new Map();
    const relDoc = parseXml(relsXml);
    const relNodes = relDoc.getElementsByTagName('Relationship');
    for (let i = 0; i < relNodes.length; i++) {
      const id = relNodes[i].getAttribute('Id');
      const target = relNodes[i].getAttribute('Target');
      if (id && target) {
        const clean = target.replace(/^\/+/, '');
        relMap.set(id, clean.startsWith('xl/') ? clean : `xl/${clean}`);
      }
    }

    const wbDoc = parseXml(wbXml);
    const sheetNodes = wbDoc.getElementsByTagName('sheet');
    for (let i = 0; i < sheetNodes.length; i++) {
      const name = sheetNodes[i].getAttribute('name') || `Aba ${i + 1}`;
      const rId = sheetNodes[i].getAttribute('r:id')
        || sheetNodes[i].getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
      const path = rId ? relMap.get(rId) : null;
      if (!path) continue;
      const xml = await zip.readText(path);
      if (xml) sheets.push({ name, rows: parseWorksheetRows(xml, sharedStrings) });
    }
  }

  if (!sheets.length) {
    const fallbackPaths = zip.listPaths().filter(p => /^xl\/worksheets\/sheet\d+\.xml$/i.test(p)).sort();
    for (let i = 0; i < fallbackPaths.length; i++) {
      const xml = await zip.readText(fallbackPaths[i]);
      if (xml) sheets.push({ name: `Aba ${i + 1}`, rows: parseWorksheetRows(xml, sharedStrings) });
    }
  }
  return sheets;
}

// =========================================================================
// DETECÇÃO AUTOMÁTICA DE CABEÇALHOS E EXTRAÇÃO DE POSIÇÕES
// =========================================================================
function scoreTickerHeader(h) {
  if (!h) return 0;
  if (h === 'codigo de negociacao' || h === 'cod negociacao' || h === 'codigo negociacao') return 100;
  if (h === 'ticker' || h === 'codigo do ativo' || h === 'codigo ativo') return 95;
  if (h === 'codigo' || h === 'cod' || h === 'papel' || h === 'sigla' || h === 'ativo') return 85;
  if (h.includes('codigo') && h.includes('negociac')) return 95;
  if (h.includes('ticker') || h.includes('papel')) return 80;
  if (h === 'produto' || h === 'titulo' || h === 'especificacao' || h === 'ativo produto') return 60;
  if (h.includes('produto') || h.includes('ativo')) return 45;
  return 0;
}

function scoreQtyHeader(h) {
  if (!h) return 0;
  if (h.includes('bloquead') || h.includes('indisponivel') || h.includes('alugad') || h.includes('garantia')) return 10;
  if (h === 'quantidade' || h === 'qtd' || h === 'qtde' || h === 'quantidade total' || h === 'qtd total') return 100;
  if (h === 'quantidade disponivel' || h === 'qtd disponivel' || h === 'saldo' || h === 'saldo total' || h === 'cotas') return 88;
  if (h === 'posicao' || h === 'custodia') return 70;
  if (h.includes('quantidade') || h.includes('qtde') || /\bqtd\b/.test(h)) return 80;
  if (h.includes('cotas')) return 65;
  return 0;
}

function scoreInstitutionHeader(h) {
  if (!h) return 0;
  if (h === 'instituicao' || h === 'corretora' || h === 'agente de custodia' || h === 'custodiante') return 100;
  if (h.includes('instituic') || h.includes('corretora') || h.includes('custodia') || h === 'banco') return 80;
  return 0;
}

function scorePriceHeader(h) {
  if (!h) return 0;
  if (h.includes('medio')) return 0;
  if (h === 'preco de fechamento' || h === 'preco fechamento' || h === 'cotacao' || h === 'preco atual') return 100;
  if (h === 'preco' || h === 'valor unitario' || h.includes('fechamento') || h.includes('cotacao')) return 75;
  return 0;
}

function scoreAvgPriceHeader(h) {
  if (!h) return 0;
  if (h === 'preco medio' || h === 'custo medio' || h === 'pm') return 100;
  if (h.includes('preco medio') || h.includes('custo medio')) return 85;
  return 0;
}

function detectColumnsInSheet(rows) {
  const limit = Math.min(rows.length, 20);
  let best = null;

  for (let r = 0; r < limit; r++) {
    const row = rows[r];
    if (!row || row.length < 2) continue;

    let tickerIdx = -1, tickerScore = 0, tickerLabel = '';
    let fallbackTickerIdx = -1, fallbackTickerScore = 0;
    let qtyIdx = -1, qtyScore = 0, qtyLabel = '';
    let instIdx = -1, instScore = 0, instLabel = '';
    let priceIdx = -1, priceScore = 0;
    let avgIdx = -1, avgScore = 0;

    for (let c = 0; c < row.length; c++) {
      const cell = row[c];
      if (!cell) continue;
      const rawLabel = String(cell.raw ?? '').trim();
      const h = normHeader(rawLabel);
      if (!h) continue;

      const ts = scoreTickerHeader(h);
      if (ts > tickerScore) {
        if (tickerIdx >= 0 && tickerScore > fallbackTickerScore) {
          fallbackTickerIdx = tickerIdx;
          fallbackTickerScore = tickerScore;
        }
        tickerScore = ts;
        tickerIdx = c;
        tickerLabel = rawLabel;
      } else if (ts > fallbackTickerScore) {
        fallbackTickerScore = ts;
        fallbackTickerIdx = c;
      }

      const qs = scoreQtyHeader(h);
      if (qs > qtyScore) {
        qtyScore = qs;
        qtyIdx = c;
        qtyLabel = rawLabel;
      }

      const is = scoreInstitutionHeader(h);
      if (is > instScore) {
        instScore = is;
        instIdx = c;
        instLabel = rawLabel;
      }

      const ps = scorePriceHeader(h);
      if (ps > priceScore) {
        priceScore = ps;
        priceIdx = c;
      }

      const as = scoreAvgPriceHeader(h);
      if (as > avgScore) {
        avgScore = as;
        avgIdx = c;
      }
    }

    if (tickerIdx >= 0 && qtyIdx >= 0 && tickerIdx !== qtyIdx) {
      const totalScore = tickerScore + qtyScore + (instIdx >= 0 ? 15 : 0);
      if (!best || totalScore > best.totalScore) {
        best = {
          headerRow: r,
          tickerIdx,
          fallbackTickerIdx,
          qtyIdx,
          instIdx,
          priceIdx,
          avgIdx,
          tickerLabel,
          qtyLabel,
          instLabel,
          totalScore
        };
      }
    }
  }
  return best;
}

function extractPositionsFromSheets(sheets, fileName, format) {
  const byTicker = new Map();
  const byInstitution = new Map();
  const institutions = new Set();
  const detectedSheets = [];
  const detectedColumnLabels = new Set();
  let ignoredRows = 0;

  for (const sheet of sheets) {
    const cols = detectColumnsInSheet(sheet.rows);
    if (!cols) continue;

    let sheetValidCount = 0;
    for (let r = cols.headerRow + 1; r < sheet.rows.length; r++) {
      const row = sheet.rows[r];
      if (!row) continue;

      const primaryRaw = row[cols.tickerIdx]?.raw;
      const fallbackRaw = cols.fallbackTickerIdx >= 0 ? row[cols.fallbackTickerIdx]?.raw : '';
      const ticker = normalizeTicker(primaryRaw, true) || normalizeTicker(fallbackRaw, true);
      if (!ticker) {
        ignoredRows++;
        continue;
      }

      const qty = parseCellNumber(row[cols.qtyIdx]);
      if (!Number.isFinite(qty) || qty <= 0) {
        ignoredRows++;
        continue;
      }

      const inst = cols.instIdx >= 0 ? String(row[cols.instIdx]?.raw ?? '').replace(/\s+/g, ' ').trim() : '';
      const price = cols.priceIdx >= 0 ? parseCellNumber(row[cols.priceIdx]) : NaN;
      const avgPrice = cols.avgIdx >= 0 ? parseCellNumber(row[cols.avgIdx]) : NaN;

      sheetValidCount++;
      if (inst) institutions.add(inst);

      const addToMap = (targetMap, key) => {
        const cur = targetMap.get(key) || {
          ticker,
          quantidade: 0,
          preco: Number.isFinite(price) && price > 0 ? price : null,
          precoMedio: Number.isFinite(avgPrice) && avgPrice > 0 ? avgPrice : null,
          instituicoes: new Set(),
          sheets: new Set()
        };
        cur.quantidade = Number((cur.quantidade + qty).toFixed(8));
        if (cur.preco === null && Number.isFinite(price) && price > 0) cur.preco = price;
        if (cur.precoMedio === null && Number.isFinite(avgPrice) && avgPrice > 0) cur.precoMedio = avgPrice;
        if (inst) cur.instituicoes.add(inst);
        cur.sheets.add(sheet.name);
        targetMap.set(key, cur);
      };

      addToMap(byTicker, ticker);
      if (inst) {
        if (!byInstitution.has(inst)) byInstitution.set(inst, new Map());
        addToMap(byInstitution.get(inst), ticker);
      }
    }

    if (sheetValidCount > 0) {
      detectedSheets.push(sheet.name);
      if (cols.tickerLabel) detectedColumnLabels.add(cols.tickerLabel);
      if (cols.qtyLabel) detectedColumnLabels.add(cols.qtyLabel);
      if (cols.instLabel) detectedColumnLabels.add(cols.instLabel);
    }
  }

  if (byTicker.size === 0) {
    throw new Error('Não foi possível localizar colunas de Ativo/Código e Quantidade com ativos B3 neste arquivo.');
  }

  const serializeMap = map => {
    const out = {};
    for (const [ticker, item] of map.entries()) {
      out[ticker] = {
        ticker,
        quantidade: item.quantidade,
        preco: item.preco,
        precoMedio: item.precoMedio,
        instituicoes: Array.from(item.instituicoes).sort((a, b) => a.localeCompare(b, 'pt-BR')),
        sheets: Array.from(item.sheets)
      };
    }
    return out;
  };

  const byInstSerialized = {};
  for (const [inst, map] of byInstitution.entries()) {
    byInstSerialized[inst] = serializeMap(map);
  }

  const allMap = serializeMap(byTicker);
  return {
    fileName,
    format,
    sheetsParsed: detectedSheets,
    detectedColumns: Array.from(detectedColumnLabels),
    totalTickers: Object.keys(allMap).length,
    ignoredRows,
    byTicker: allMap,
    byInstitution: byInstSerialized,
    institutions: Array.from(institutions).sort((a, b) => a.localeCompare(b, 'pt-BR'))
  };
}

export async function parsePositionFile(file) {
  if (!file) throw new Error('Nenhum arquivo selecionado.');
  const name = String(file.name || 'arquivo');
  const lower = name.toLowerCase();
  const buffer = await file.arrayBuffer();
  const head = new Uint8Array(buffer.slice(0, 8));

  // Detecta .xls binário legado (OLE2: D0 CF 11 E0)
  if (head.length >= 4 && head[0] === 0xD0 && head[1] === 0xCF && head[2] === 0x11 && head[3] === 0xE0) {
    throw new Error('Arquivos Excel antigos (.xls) não são suportados. Salve como .xlsx ou .csv e importe novamente.');
  }

  const isZip = head.length >= 2 && head[0] === 0x50 && head[1] === 0x4B;
  if (lower.endsWith('.xlsx') || isZip) {
    const sheets = await extractXlsxSheets(buffer);
    return extractPositionsFromSheets(sheets, name, 'xlsx');
  }

  if (lower.endsWith('.csv') || lower.endsWith('.txt') || lower.endsWith('.tsv')) {
    const text = decodeTextBuffer(buffer);
    const rows = parseCsvRows(text);
    return extractPositionsFromSheets([{ name: 'CSV', rows }], name, 'csv');
  }

  // Fallback: tenta ler como CSV texto
  const text = decodeTextBuffer(buffer);
  const rows = parseCsvRows(text);
  return extractPositionsFromSheets([{ name: 'Arquivo', rows }], name, 'csv');
}
