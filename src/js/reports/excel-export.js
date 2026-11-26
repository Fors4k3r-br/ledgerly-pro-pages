// Utilitários de geração do arquivo XLSX usado pelos relatórios do Ledgerly Pro.
// A montagem dos dados financeiros e o acionamento do download permanecem no index.html.

export function xmlEscape(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function excelCol(n) {
  let s = '';
  while (n) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function makeSheetXml(rows) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.map((row, ri) => `<row r="${ri + 1}">${row.map((v, ci) => {
    const ref = excelCol(ci + 1) + (ri + 1);
    return typeof v === 'number' && Number.isFinite(v)
      ? `<c r="${ref}"><v>${v}</v></c>`
      : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(v)}</t></is></c>`;
  }).join('')}</row>`).join('')}</sheetData></worksheet>`;
}

export function crc32(bytes) {
  let c = -1;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ ((c & 1) ? 0xEDB88320 : 0);
  }
  return (c ^ -1) >>> 0;
}

export function zipStore(files) {
  const enc = new TextEncoder(), parts = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name), data = enc.encode(f.data), crc = crc32(data);
    const local = new Uint8Array(30 + name.length + data.length), v = new DataView(local.buffer);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, 20, true);
    v.setUint16(6, 0, true);
    v.setUint16(8, 0, true);
    v.setUint32(14, crc, true);
    v.setUint32(18, data.length, true);
    v.setUint32(22, data.length, true);
    v.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(data, 30 + name.length);
    parts.push(local);

    const cd = new Uint8Array(46 + name.length), d = new DataView(cd.buffer);
    d.setUint32(0, 0x02014b50, true);
    d.setUint16(4, 20, true);
    d.setUint16(6, 20, true);
    d.setUint16(8, 0, true);
    d.setUint16(10, 0, true);
    d.setUint32(16, crc, true);
    d.setUint32(20, data.length, true);
    d.setUint32(24, data.length, true);
    d.setUint16(28, name.length, true);
    d.setUint32(42, offset, true);
    cd.set(name, 46);
    central.push(cd);
    offset += local.length;
  }
  const centralSize = central.reduce((a, x) => a + x.length, 0);
  const end = new Uint8Array(22), e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, files.length, true);
  e.setUint16(10, files.length, true);
  e.setUint32(12, centralSize, true);
  e.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
}

// Compatibilidade com exportReportsExcel(), que continua no script clássico.
Object.assign(globalThis, { xmlEscape, excelCol, makeSheetXml, crc32, zipStore });

// Ponte de compatibilidade: mantém os nomes públicos acessíveis ao HTML e aos demais módulos.
Object.defineProperty(globalThis, "xmlEscape", { configurable: true, enumerable: true, get: () => xmlEscape, set: value => { xmlEscape = value; } });
Object.defineProperty(globalThis, "excelCol", { configurable: true, enumerable: true, get: () => excelCol, set: value => { excelCol = value; } });
Object.defineProperty(globalThis, "makeSheetXml", { configurable: true, enumerable: true, get: () => makeSheetXml, set: value => { makeSheetXml = value; } });
Object.defineProperty(globalThis, "crc32", { configurable: true, enumerable: true, get: () => crc32, set: value => { crc32 = value; } });
Object.defineProperty(globalThis, "zipStore", { configurable: true, enumerable: true, get: () => zipStore, set: value => { zipStore = value; } });
