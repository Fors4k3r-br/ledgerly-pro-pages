// Camada SQLite (central.db e daily.db), persistência no IndexedDB, corretoras, backups e restauração.

import { SQL, setSQL, db, setDb, dailyDb, setDailyDb, IDB_NAME, IDB_STORE, IDB_KEY, DAILY_IDB_KEY, LEGACY_IDB_KEY } from './state.js';
import { escapeSavedNoteText } from './utils.js';
import { notifyAfterPersist, notifyEmptyIdbRecovery, notifyFreshInstallReset } from './events.js';
import { applyTheme, showToast } from '../ui/navigation.js';

// =========================================================================
// 1. BANCO DE DADOS SQLITE (sql.js + Persistência Binária no IndexedDB)
// =========================================================================
export async function initSQLiteDatabase() {
  try {
    setSQL(await initSqlJs({ locateFile: file => `./vendor/${file}` }));
    // A instalação começa com dois bancos novos. Não importa o banco único legado,
    // nem suas configurações, conforme a validação explícita do usuário.
    const centralBytes = await loadBinaryFromIndexedDB(IDB_KEY);
    const dailyBytes = await loadBinaryFromIndexedDB(DAILY_IDB_KEY);
    const freshSplitInstall = !centralBytes && !dailyBytes;

    // Detecta se já havia sincronização configurada antes de o navegador limpar o IndexedDB (comum no iOS).
    let prevSync = null;
    try {
      const rawSync = localStorage.getItem('ledgerly_sync');
      if (rawSync) prevSync = JSON.parse(rawSync);
    } catch (_) {}
    const hadDriveConnection = Boolean(prevSync && prevSync.connected);

    setDb(centralBytes ? new SQL.Database(new Uint8Array(centralBytes)) : new SQL.Database());
    setDailyDb(dailyBytes ? new SQL.Database(new Uint8Array(dailyBytes)) : new SQL.Database());
    createCentralSchema(db);
    createDailySchema(dailyDb);
    await persistSQLiteToIndexedDB({ suppressSync: true });
    // A escolha foi iniciar sem backup: remove a chave antiga somente depois
    // de ambos os bancos novos estarem gravados e validados.
    await deleteIndexedDBKey(LEGACY_IDB_KEY);
    if (freshSplitInstall && !hadDriveConnection) {
      try { ['ledgerly_sync','ledgerly_pin_fails','ledgerly_pin_lock','ledgerly_theme','ledgerly_profit_range','ledgerly_chart_mode'].forEach(k => localStorage.removeItem(k)); } catch (_) {}
      try { applyTheme('default'); } catch (_) {}
      await notifyFreshInstallReset();
    } else if (freshSplitInstall && hadDriveConnection) {
      // Preserva a conexão com o Drive, tokens e estado de bloqueio do PIN,
      // e bloqueia qualquer upload automático antes de baixar a cópia da nuvem.
      notifyEmptyIdbRecovery();
      try { showToast('Dados locais foram limpos pelo navegador. Reconectando ao Google Drive para restaurar…', 'info'); } catch (_) {}
    }
    try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (_) {}
  } catch (err) {
    console.error('Erro ao inicializar SQLite:', err);
    showToast('Erro ao iniciar o banco de dados.', 'error');
    throw err;
  }
}

const LEDGERLY_SCHEMA_VERSION = 3;

export function rowsFromDatabase(database, sql, params = []) {
  const stmt = database.prepare(sql); stmt.bind(params); const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free(); return rows;
}

export function createCentralSchema(target) {
  target.run('PRAGMA foreign_keys = ON;');
  const has = rowsFromDatabase(target, "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'").length > 0;
  if (has && Number(rowsFromDatabase(target, 'SELECT COALESCE(MAX(version),0) AS v FROM schema_migrations')[0]?.v || 0) >= LEDGERLY_SCHEMA_VERSION) { const ok=rowsFromDatabase(target,'PRAGMA integrity_check'); if (!ok.length || ok[0].integrity_check!=='ok' || rowsFromDatabase(target,'PRAGMA foreign_key_check').length) throw new Error('Falha na validação do central.db.'); return; }
  // Para a instalação inicial, o schema central é criado vazio e sem tabelas patrimoniais.
  target.run(`
    CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, aplicado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, descricao TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS corretoras (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, cnpj TEXT UNIQUE);
    CREATE TABLE IF NOT EXISTS ativos (ticker TEXT PRIMARY KEY COLLATE NOCASE, nome TEXT, criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, atualizado_em TEXT);
    CREATE TABLE IF NOT EXISTS notas_corretagem (id INTEGER PRIMARY KEY AUTOINCREMENT, numero_controle TEXT NOT NULL UNIQUE, data_pregao TEXT NOT NULL, valor_operacoes REAL DEFAULT 0, total_cblc_bruto REAL DEFAULT 0, taxa_cblc REAL DEFAULT 0, taxa_bovespa REAL DEFAULT 0, taxa_corretagem REAL DEFAULT 0, valor_liquido_nota REAL DEFAULT 0, nome_arquivo TEXT, arquivo_base64 TEXT, criado_em TEXT, corretora_id INTEGER, FOREIGN KEY(corretora_id) REFERENCES corretoras(id) ON UPDATE CASCADE ON DELETE SET NULL);
    CREATE TABLE IF NOT EXISTS operacoes (id INTEGER PRIMARY KEY AUTOINCREMENT, nota_id INTEGER, numero_nota TEXT, data_operacao TEXT NOT NULL, ticker TEXT NOT NULL COLLATE NOCASE, especificacao TEXT, tipo_ordem TEXT NOT NULL, quantidade REAL NOT NULL, preco_unitario REAL NOT NULL, valor_operacao REAL NOT NULL, taxa_cblc REAL DEFAULT 0, taxa_bovespa REAL DEFAULT 0, taxa_corretagem REAL DEFAULT 0, corretora_id INTEGER, FOREIGN KEY(nota_id) REFERENCES notas_corretagem(id) ON UPDATE CASCADE ON DELETE CASCADE, FOREIGN KEY(ticker) REFERENCES ativos(ticker) ON UPDATE CASCADE ON DELETE RESTRICT, FOREIGN KEY(corretora_id) REFERENCES corretoras(id) ON UPDATE CASCADE ON DELETE SET NULL);
    CREATE TABLE IF NOT EXISTS cotacoes_atuais (ticker TEXT PRIMARY KEY COLLATE NOCASE, preco_atual REAL NOT NULL, atualizado_em TEXT, FOREIGN KEY(ticker) REFERENCES ativos(ticker) ON UPDATE CASCADE ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS proventos (id INTEGER PRIMARY KEY AUTOINCREMENT, ticker TEXT NOT NULL COLLATE NOCASE, tipo TEXT NOT NULL, data_pagamento TEXT NOT NULL, quantidade REAL DEFAULT 0, valor_bruto REAL NOT NULL, imposto REAL DEFAULT 0, valor_liquido REAL NOT NULL, observacao TEXT, corretora_id INTEGER, FOREIGN KEY(ticker) REFERENCES ativos(ticker) ON UPDATE CASCADE ON DELETE RESTRICT, FOREIGN KEY(corretora_id) REFERENCES corretoras(id) ON UPDATE CASCADE ON DELETE SET NULL);
    CREATE TABLE IF NOT EXISTS classificacao_manual (codigo TEXT PRIMARY KEY COLLATE NOCASE, setor TEXT NOT NULL, subsetor TEXT DEFAULT '', atualizado_em TEXT);
    CREATE TABLE IF NOT EXISTS configuracoes_seguranca (chave TEXT PRIMARY KEY, valor TEXT);
    CREATE INDEX IF NOT EXISTS idx_notas_data ON notas_corretagem(data_pregao,id);
    CREATE INDEX IF NOT EXISTS idx_notas_corretora ON notas_corretagem(corretora_id,data_pregao);
    CREATE INDEX IF NOT EXISTS idx_operacoes_ticker_data ON operacoes(ticker,data_operacao,id);
    CREATE INDEX IF NOT EXISTS idx_operacoes_data_ticker ON operacoes(data_operacao,ticker,id);
    CREATE INDEX IF NOT EXISTS idx_operacoes_nota ON operacoes(nota_id);
    CREATE INDEX IF NOT EXISTS idx_operacoes_corretora ON operacoes(corretora_id,ticker);
    CREATE INDEX IF NOT EXISTS idx_proventos_ticker_data ON proventos(ticker,data_pagamento,id);
    CREATE INDEX IF NOT EXISTS idx_proventos_data ON proventos(data_pagamento,id);
    CREATE INDEX IF NOT EXISTS idx_proventos_corretora ON proventos(corretora_id,data_pagamento);
    CREATE TRIGGER IF NOT EXISTS trg_operacoes_ensure_asset BEFORE INSERT ON operacoes BEGIN INSERT OR IGNORE INTO ativos(ticker) VALUES(UPPER(TRIM(NEW.ticker))); END;
    CREATE TRIGGER IF NOT EXISTS trg_proventos_ensure_asset BEFORE INSERT ON proventos BEGIN INSERT OR IGNORE INTO ativos(ticker) VALUES(UPPER(TRIM(NEW.ticker))); END;
    CREATE TRIGGER IF NOT EXISTS trg_cotacoes_ensure_asset BEFORE INSERT ON cotacoes_atuais BEGIN INSERT OR IGNORE INTO ativos(ticker) VALUES(UPPER(TRIM(NEW.ticker))); END;
  `);
  target.run("INSERT OR REPLACE INTO schema_migrations(version,descricao) VALUES (3,'Separação entre banco central da carteira e histórico patrimonial diário')");
  const integrity = rowsFromDatabase(target, 'PRAGMA integrity_check');
  if (!integrity.length || integrity[0].integrity_check !== 'ok') throw new Error('Integridade do central.db inválida.');
  if (rowsFromDatabase(target, 'PRAGMA foreign_key_check').length) throw new Error('Há vínculos inválidos no central.db.');
}

export function createDailySchema(target) {
  target.run('PRAGMA foreign_keys = ON;');
  target.run(`
    CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, aplicado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, descricao TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS snapshots_patrimonio (id INTEGER PRIMARY KEY AUTOINCREMENT, data_referencia TEXT NOT NULL UNIQUE, total_investido REAL NOT NULL DEFAULT 0, valor_mercado REAL NOT NULL DEFAULT 0, resultado REAL NOT NULL DEFAULT 0, proventos_recebidos REAL NOT NULL DEFAULT 0, registrado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS snapshot_patrimonio_ativos (id INTEGER PRIMARY KEY AUTOINCREMENT, snapshot_id INTEGER NOT NULL, ticker TEXT NOT NULL COLLATE NOCASE, quantidade REAL NOT NULL DEFAULT 0, preco_medio REAL NOT NULL DEFAULT 0, custo_total REAL NOT NULL DEFAULT 0, cotacao REAL NOT NULL DEFAULT 0, valor_mercado REAL NOT NULL DEFAULT 0, resultado REAL NOT NULL DEFAULT 0, FOREIGN KEY(snapshot_id) REFERENCES snapshots_patrimonio(id) ON UPDATE CASCADE ON DELETE CASCADE, UNIQUE(snapshot_id,ticker));
    CREATE INDEX IF NOT EXISTS idx_snapshots_data ON snapshots_patrimonio(data_referencia DESC);
    CREATE INDEX IF NOT EXISTS idx_snapshot_ativos_ticker ON snapshot_patrimonio_ativos(ticker,snapshot_id);
  `);
  target.run("INSERT OR REPLACE INTO schema_migrations(version,descricao) VALUES (1,'Histórico patrimonial diário independente do cadastro central')");
  const integrity = rowsFromDatabase(target, 'PRAGMA integrity_check');
  if (!integrity.length || integrity[0].integrity_check !== 'ok') throw new Error('Integridade do daily.db inválida.');
  if (rowsFromDatabase(target, 'PRAGMA foreign_key_check').length) throw new Error('Há vínculos inválidos no daily.db.');
}

async function createSchemaIfNotExists() { createCentralSchema(db); }

// Corretora vinculada a cada nota e a cada operação (migração segura de bancos antigos)
function ensureColumn(table, col, ddl) {
  const cols = queryAll(`PRAGMA table_info(${table})`).map(c => c.name);
  if (!cols.includes(col)) db.run(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`);
}
export function ensureCorretora(nome, cnpj) {
  nome = String(nome || '').replace(/\s+/g, ' ').trim();
  cnpj = String(cnpj || '').trim() || null;
  let row;
  if (cnpj) row = queryAll('SELECT id FROM corretoras WHERE cnpj = ?', [cnpj])[0];
  else if (nome) row = queryAll('SELECT id FROM corretoras WHERE cnpj IS NULL AND UPPER(nome) = UPPER(?)', [nome])[0];
  else return null;
  if (row) return row.id;
  db.run('INSERT INTO corretoras (nome, cnpj) VALUES (?, ?)', [nome || ('Corretora ' + cnpj), cnpj]);
  return queryAll('SELECT last_insert_rowid() AS id')[0].id;
}
// Segurança para restaurar backups antigos: garante as colunas sem alterar nenhum dado
function ensureCorretoraColumns() {
  ['notas_corretagem', 'operacoes', 'proventos'].forEach(t => ensureColumn(t, 'corretora_id', 'INTEGER'));
  db.run('CREATE INDEX IF NOT EXISTS idx_operacoes_corretora ON operacoes(corretora_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_notas_corretora ON notas_corretagem(corretora_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_proventos_corretora ON proventos(corretora_id)');
}
export function fillCorretoraSelects() {
  const corr = queryAll('SELECT id, nome FROM corretoras ORDER BY nome');
  const opts = corr.map(c => `<option value="${c.id}">${escapeSavedNoteText(c.nome)}</option>`).join('');
  const set = (id, html) => {
    const el = document.getElementById(id); if (!el) return;
    const prev = el.value; el.innerHTML = html;
    if (Array.from(el.options).some(o => o.value === prev)) el.value = prev;
  };
  const temSemCorretora = Number(queryAll('SELECT COUNT(*) AS n FROM operacoes WHERE corretora_id IS NULL')[0].n) > 0;
  set('positionsCorretora', '<option value="">Todas as corretoras</option>' + (temSemCorretora ? '<option value="none">Sem corretora</option>' : '') + opts);
  set('savedNotesCorretora', '<option value="">Todas as corretoras</option>' + opts);
  set('provCorretora', '<option value="">Não informada</option>' + opts);
  set('provFilterCorretora', '<option value="">Todas as corretoras</option>' + opts);
  set('manCorretora', '<option value="">Não informada</option>' + opts + '<option value="__new__">＋ Nova corretora…</option>');
  onManCorretoraChange();
}
export function onManCorretoraChange() {
  const sel = document.getElementById('manCorretora'), nova = document.getElementById('manCorretoraNova');
  if (nova && sel) nova.classList.toggle('hidden', sel.value !== '__new__');
}

function openIndexedDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const idb = e.target.result;
      if (!idb.objectStoreNames.contains(IDB_STORE)) {
        idb.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

export async function persistSQLiteToIndexedDB(options = {}) {
  if (!db || !dailyDb) return;
  const centralData = db.export(), dailyData = dailyDb.export();
  const idb = await openIndexedDB();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(IDB_STORE, 'readwrite');
    const store = tx.objectStore(IDB_STORE);
    store.put(centralData, IDB_KEY);
    store.put(dailyData, DAILY_IDB_KEY);
    tx.oncomplete = () => {
      idb.close();
      resolve();
      if (!options.suppressSync) {
        notifyAfterPersist({ userEdit: options.userEdit !== false }).catch(e => console.warn('Não foi possível agendar sincronização:', e));
      }
    };
    const fail = (fallbackMsg) => {
      const err = tx.error || new Error(fallbackMsg);
      idb.close();
      if (err && err.name === 'QuotaExceededError') {
        try { showToast('Armazenamento do navegador cheio. Libere espaço para salvar os dados.', 'error'); } catch (_) {}
      }
      reject(err);
    };
    tx.onerror = () => fail('Erro na transação de gravação do IndexedDB.');
    tx.onabort = () => fail('Transação de gravação no IndexedDB abortada (possível falta de espaço).');
  });
}

async function loadBinaryFromIndexedDB(key = IDB_KEY) {
  const idb = await openIndexedDB();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(key);
    tx.oncomplete = () => { idb.close(); resolve(req.result || null); };
    tx.onerror = () => { idb.close(); reject(tx.error || req.error); };
    tx.onabort = () => { idb.close(); reject(tx.error || new Error('Leitura do IndexedDB abortada.')); };
  });
}

async function deleteIndexedDBKey(key) {
  const idb = await openIndexedDB();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(key);
    tx.oncomplete = () => { idb.close(); resolve(); };
    tx.onerror = () => { idb.close(); reject(tx.error); };
    tx.onabort = () => { idb.close(); reject(tx.error || new Error('Exclusão no IndexedDB abortada.')); };
  });
}

// Helper para consultas SQL retornando array de objetos
export function queryAll(sql, params = []) {
  if (!db) return [];
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

export function getSetting(key) {
  const rows = queryAll('SELECT valor FROM configuracoes_seguranca WHERE chave = ?', [key]);
  return rows.length > 0 ? rows[0].valor : null;
}

export async function setSetting(key, value, options = {}) {
  db.run('INSERT OR REPLACE INTO configuracoes_seguranca (chave, valor) VALUES (?, ?)', [key, String(value)]);
  await persistSQLiteToIndexedDB(options);
}

// =========================================================================
// 8. BACKUP SQLITE NO GOOGLE DRIVE, BACKUP LOCAL E LIMPAR DADOS
// =========================================================================
export function updateDatabaseStats() {
  const nCount = queryAll('SELECT COUNT(*) as c FROM notas_corretagem')[0]?.c || 0;
  const oCount = queryAll('SELECT COUNT(*) as c FROM operacoes')[0]?.c || 0;
  const lastBkp = getSetting('ultimo_backup') || 'Nunca';

  document.getElementById('statNotasCount').textContent = nCount;
  document.getElementById('statOperacoesCount').textContent = oCount;
  document.getElementById('statUltimoBackup').textContent = lastBkp;
}
