/**
 * Classificação setorial de ativos.
 * Mantém a regra de precedência: correção manual > cadastro B3 > regra automática.
 * A camada SQLite continua no app principal; este módulo recebe apenas os registros.
 */
const setorDb = globalThis.LEDGERLY_SETORES || {
  setores: [],
  subsetores: [],
  empresas: {}
};

const setoresEspeciais = ['Fundos e ETFs', 'BDRs'];
let classificacaoManual = Object.create(null);

export function tickerCode(ticker) {
  return String(ticker || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
}

export function setManualSectorClass(rows = []) {
  const next = Object.create(null);
  for (const row of rows || []) {
    if (!row || !row.codigo) continue;
    next[row.codigo] = {
      setor: row.setor,
      subsetor: row.subsetor || ''
    };
  }
  classificacaoManual = next;
}

// Ordem preservada: manual > B3 > fundos/ETFs e BDRs > pendente.
export function classifyTicker(ticker) {
  const normalizedTicker = String(ticker || '').toUpperCase();
  const code = tickerCode(normalizedTicker);
  const manual = classificacaoManual[code];

  if (manual) {
    return { setor: manual.setor, subsetor: manual.subsetor, origem: 'manual', code };
  }

  const index = setorDb.empresas[code];
  if (index !== undefined) {
    const item = setorDb.subsetores[index];
    if (item) {
      return {
        setor: setorDb.setores[item[0]],
        subsetor: item[1],
        origem: 'b3',
        code
      };
    }
  }

  if (/11$/.test(normalizedTicker)) {
    return { setor: 'Fundos e ETFs', subsetor: '', origem: 'auto', code };
  }
  if (/(32|33|34|35|39)$/.test(normalizedTicker)) {
    return { setor: 'BDRs', subsetor: '', origem: 'auto', code };
  }
  return { setor: 'Sem classificação', subsetor: '', origem: 'pendente', code };
}

export function subsetoresDe(setor) {
  const index = setorDb.setores.indexOf(setor);
  return index < 0
    ? []
    : setorDb.subsetores.filter(item => item[0] === index).map(item => item[1]);
}

export function setorOptions() {
  return setorDb.setores.concat(setoresEspeciais);
}

// Compatibilidade temporária com as funções e handlers ainda definidos no index.html.
Object.assign(globalThis, {
  tickerCode,
  setManualSectorClass,
  classifyTicker,
  subsetoresDe,
  setorOptions
});

// Ponte de compatibilidade: mantém os nomes públicos acessíveis ao HTML e aos demais módulos.
Object.defineProperty(globalThis, "setorDb", { configurable: true, enumerable: true, get: () => setorDb });
Object.defineProperty(globalThis, "setoresEspeciais", { configurable: true, enumerable: true, get: () => setoresEspeciais });
Object.defineProperty(globalThis, "classificacaoManual", { configurable: true, enumerable: true, get: () => classificacaoManual, set: value => { classificacaoManual = value; } });
Object.defineProperty(globalThis, "tickerCode", { configurable: true, enumerable: true, get: () => tickerCode, set: value => { tickerCode = value; } });
Object.defineProperty(globalThis, "setManualSectorClass", { configurable: true, enumerable: true, get: () => setManualSectorClass, set: value => { setManualSectorClass = value; } });
Object.defineProperty(globalThis, "classifyTicker", { configurable: true, enumerable: true, get: () => classifyTicker, set: value => { classifyTicker = value; } });
Object.defineProperty(globalThis, "subsetoresDe", { configurable: true, enumerable: true, get: () => subsetoresDe, set: value => { subsetoresDe = value; } });
Object.defineProperty(globalThis, "setorOptions", { configurable: true, enumerable: true, get: () => setorOptions, set: value => { setorOptions = value; } });
