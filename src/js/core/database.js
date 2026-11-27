// Camada SQLite (central.db e daily.db), persistência no IndexedDB, corretoras, backups e restauração.

import { openDb } from '../security/encryption.js';
import { SQL, setSQL, db, setDb, dailyDb, setDailyDb, setStagedNotesQueue, IDB_NAME, IDB_STORE, IDB_KEY, DAILY_IDB_KEY, LEGACY_IDB_KEY } from './state.js';
import { escapeSavedNoteText, renderStagingScreen } from '../notes/notes-manager.js';
import { refreshAllViews, renderOnboarding, renderPositionsExpandableCards, resetChartPreferences } from '../portfolio/positions.js';
import { updateSecurityUIState } from '../security/lock-screen.js';
import { applyRemoteDb, clearConflictBackups, deleteCloudDb, disconnectSyncLocal, driveDeleteExtras, driveDownload, driveFind, ensureKey, exportSyncPackage, getToken, hashCurrentPair, idbKv, packSyncPackage, prefetched, setPrefetched, renderSyncCard, sanitizedExport, saveSyncState, setSyncStatusFlags, syncAfterPersist, syncState, unpackSyncPackage, updateConnectionBadge, validateDatabasePair, wipeAllData } from '../sync/google-drive.js';
import { applyTheme, ledgerlyModal, openConfirmDialog, showToast, switchTab } from '../ui/navigation.js';

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
      try { resetChartPreferences(); applyTheme('default'); } catch (_) {}
      try { await idbKv('del', 'main'); await idbKv('del', 'refresh'); await clearConflictBackups(); } catch (_) {}
    } else if (freshSplitInstall && hadDriveConnection) {
      // Preserva a conexão com o Drive, tokens e estado de bloqueio do PIN,
      // e bloqueia qualquer upload automático antes de baixar a cópia da nuvem.
      saveSyncState({ recoveredFromEmptyIdb: true, hasLocalUserChanges: false });
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
function setPositionsCorretora() { renderPositionsExpandableCards(); }

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
        syncAfterPersist({ userEdit: options.userEdit !== false }).catch(e => console.warn('Não foi possível agendar sincronização:', e));
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
  updateSecurityUIState();
}

async function generateSQLiteBackupFileObject() {
  const pair = await unpackSyncPackage(await exportSyncPackage());
  const safeCentral = sanitizedExport(pair.central);
  const binaryArray = await packSyncPackage(safeCentral, pair.daily);
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;
  const fileName = `ledgerly_conjunto_${stamp}.lgp`;
  const blob = new Blob([binaryArray], { type: 'application/octet-stream' });
  return { blob, fileName };
}

async function downloadLocalSQLiteBackup() {
  const { blob, fileName } = await generateSQLiteBackupFileObject();
  const nowFormatted = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  await setSetting('ultimo_backup', nowFormatted);
  updateDatabaseStats();
  triggerBlobDownload(blob, fileName);
  showToast(`Backup do banco de dados (${fileName}) baixado!`, 'success');
}

// Exporta um banco SQLite convencional para consulta externa.
// A cópia é sanitizada: remove configurações locais/sensíveis, sem alterar o banco ativo.
async function downloadIndividualSQLiteDatabase(which) {
  const database = which === 'daily' ? dailyDb : db;
  if (!database) { showToast('Banco de dados ainda não está disponível.', 'error'); return; }
  let copy = null;
  try {
    copy = new SQL.Database(database.export());
    if (which === 'central') {
      copy.run('DELETE FROM configuracoes_seguranca');
    }
    const bytes = copy.export();
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const fileName = `ledgerly_${which}_${stamp}.db`;
    triggerBlobDownload(new Blob([bytes], { type: 'application/vnd.sqlite3' }), fileName);
    showToast(`${fileName} exportado para consulta.`, 'success');
  } catch (error) {
    console.error('Falha ao exportar banco SQLite individual:', error);
    showToast('Não foi possível exportar o banco SQLite.', 'error');
  } finally { try { copy?.close(); } catch (_) {} }
}

function triggerBlobDownload(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function requestRestoreDatabase() {
  const choice = await ledgerlyModal({ title: 'Restaurar banco de dados', message: 'Escolha de onde deseja recuperar o conjunto central.db + daily.db.',
    buttons: [{ label: 'Arquivo deste aparelho (.lgp)', value: 'local', primary: true }, { label: 'Google Drive (nuvem)', value: 'cloud' }, { label: 'Cancelar', value: 'cancel' }] });
  if (choice.value === 'local') { document.getElementById('restoreDbInput')?.click(); return; }
  if (choice.value === 'cloud') await restoreDatabaseFromDrive();
}

async function restoreDatabaseFromDrive() {
  try {
    if (!navigator.onLine) throw new Error('Conecte-se à internet para restaurar o backup do Google Drive.');
    setPrefetched(null);
    const token = await getToken('interactive');
    const remote = await driveFind(token);
    if (!remote) throw new Error('Nenhum backup Ledgerly foi encontrado no Google Drive.');
    const keyResult = await ensureKey(remote, token);
    if (keyResult.remoteDeleted) throw new Error('O backup da nuvem foi removido durante a redefinição da senha. Nenhum dado foi restaurado.');
    const bytes = (prefetched && prefetched.rev === (remote.appProperties || {}).rev)
      ? prefetched.bytes : await openDb(await driveDownload(remote.id, token), keyResult.kd.key);
    openConfirmDialog({ title: 'Confirmar restauração da nuvem',
      message: 'O backup criptografado foi descriptografado. A carteira e o histórico atuais deste aparelho serão substituídos pelos dados do Google Drive.',
      requirePin: Boolean(getSetting('security_pin_hash')),
      onConfirm: async () => {
        try {
          await applyRemoteDb(bytes);
          const rev = (remote.appProperties || {}).rev || null;
          const localHash = await hashCurrentPair();
          saveSyncState({ connected: true, needsLogin: false, fileId: remote.id, baseRev: rev, syncedHash: localHash,
            localChangedAt: (remote.appProperties || {}).ts || remote.modifiedTime || new Date().toISOString(), lastSync: new Date().toISOString(),
            hasLocalUserChanges: false, recoveredFromEmptyIdb: false });
          setSyncStatusFlags({ syncPending: false, syncCloudMissing: false, syncConflict: false });
          updateConnectionBadge(); renderSyncCard(); refreshAllViews(); renderOnboarding(); switchTab('carteira');
          showToast('Conjunto central.db + daily.db restaurado do Google Drive.', 'success');
          try { await driveDeleteExtras(token, remote.id); } catch (cleanupError) { console.warn('Não foi possível remover backups duplicados do Drive:', cleanupError); showToast('Restauração concluída, mas não foi possível remover todas as cópias duplicadas da nuvem.', 'info'); }
        } catch (restoreError) {
          console.error('Falha ao aplicar backup do Google Drive:', restoreError);
          showToast('Falha ao restaurar da nuvem: ' + ((restoreError && restoreError.message) || restoreError), 'error');
        }
      }
    });
  } catch (error) {
    if (!(error && error.cancelled)) { console.error('Restauração do Google Drive:', error); showToast('Falha ao restaurar da nuvem: ' + ((error && error.message) || error), 'error'); }
  } finally { setPrefetched(null); }
}

async function handleRestoreSQLiteFile(event) {
  const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
  const fileHeader = new TextDecoder().decode(new Uint8Array(await file.slice(0, 4).arrayBuffer()));
  if (fileHeader === 'SQLi') { showToast('Este arquivo contém apenas um banco SQLite individual. Para restaurar a carteira, selecione o backup completo Ledgerly (.lgp).', 'info'); return; }
  const confirmAction = async () => {
    let nextCentral=null, nextDaily=null;
    const previousCentral=db, previousDaily=dailyDb;
    let restored=false;
    try {
      const pair=await unpackSyncPackage(new Uint8Array(await file.arrayBuffer()));
      if (pair.manifest.central.schemaVersion!==3 || pair.manifest.daily.schemaVersion!==1) throw new Error('O backup usa versões de schema incompatíveis.');
      nextCentral=new SQL.Database(pair.central); nextDaily=new SQL.Database(pair.daily);
      validateDatabasePair(nextCentral,nextDaily);
      const localBiometricId=getSetting('biometrics_cred_id');
      window.__ledgerlyApplying=true; setDb(nextCentral); setDailyDb(nextDaily);
      createCentralSchema(db); createDailySchema(dailyDb);
      if (localBiometricId && !getSetting('biometrics_cred_id')) db.run("INSERT OR REPLACE INTO configuracoes_seguranca(chave,valor) VALUES('biometrics_cred_id',?)",[localBiometricId]);
      if (!getSetting('biometrics_cred_id')) db.run("INSERT OR REPLACE INTO configuracoes_seguranca(chave,valor) VALUES('biometrics_enabled','0')");
      await persistSQLiteToIndexedDB({suppressSync:true});
      restored=true;
    } catch(err) {
      console.error('Erro ao restaurar conjunto SQLite:',err);
      try { if (db===nextCentral) setDb(previousCentral); if (dailyDb===nextDaily) setDailyDb(previousDaily); nextCentral?.close(); nextDaily?.close(); } catch(_) {}
      showToast((err && err.message) || 'O arquivo selecionado não é um conjunto Ledgerly válido.', 'error');
    } finally { window.__ledgerlyApplying=false; }
    if (restored) {
      try { previousCentral?.close(); previousDaily?.close(); } catch(_) {}
      try { refreshAllViews(); switchTab('carteira'); } catch(uiErr) { console.error('Erro ao atualizar telas após restauração:', uiErr); }
      showToast('Conjunto central.db + daily.db restaurado com sucesso!', 'success');
    }
    if (restored && syncState().connected) await syncAfterPersist().catch(e=>console.warn('Não foi possível agendar a sincronização após a restauração:',e));
  };
  openConfirmDialog({ title:'Restaurar conjunto de bancos', message:`Deseja substituir central.db e daily.db pelo conjunto de backup "${file.name}"?`, requirePin:Boolean(getSetting('security_pin_hash')), onConfirm:confirmAction });
}

async function requestWipeDatabase() {
  const choice = await ledgerlyModal({ title: 'Limpar todos os dados',
    message: 'Escolha o alcance da limpeza. O PIN, as configurações e o token da brapi serão mantidos.',
    buttons: [{ label: 'Somente neste aparelho', value: 'local', primary: true }, { label: 'Aparelho + Google Drive', value: 'all' }, { label: 'Cancelar', value: 'cancel' }] });
  if (choice.value === 'cancel') return;
  const cloud = choice.value === 'all';
  openConfirmDialog({ title: cloud ? 'Apagar carteira e backup da nuvem?' : 'Limpar dados deste aparelho?',
    message: cloud
      ? 'Serão apagados os dados de investimentos deste aparelho e TODOS os backups Ledgerly encontrados no Google Drive. A cópia criptografada da nuvem também será excluída. A sincronização será desconectada para impedir que o backup seja recriado. Esta ação não pode ser desfeita.'
      : 'Serão apagados os dados de investimentos deste aparelho. O backup do Google Drive será mantido, mas a sincronização será desconectada para impedir que a carteira vazia sobrescreva a cópia da nuvem. Uma cópia local de segurança ficará disponível para restauração.',
    requirePin: Boolean(getSetting('security_pin_hash')),
    onConfirm: async () => {
      try {
        if (cloud) await deleteCloudDb();
        await wipeAllData({ keepLocalRecovery: !cloud, suppressSync: true });
        await disconnectSyncLocal();
        if (cloud) { await clearConflictBackups(); }
        setStagedNotesQueue([]); renderStagingScreen(); refreshAllViews(); updateConnectionBadge(); renderSyncCard();
        showToast(cloud ? 'Dados locais e backup do Google Drive excluídos.' : 'Dados locais limpos. O backup da nuvem foi preservado e a sincronização desconectada.', 'success');
      } catch (error) {
        showToast('Falha ao limpar os dados: ' + ((error && error.message) || error), 'error');
      }
    }
  });
}

// Compatibilidade apenas para handlers inline no HTML/templates.
Object.assign(globalThis, {
  downloadIndividualSQLiteDatabase,
  downloadLocalSQLiteBackup,
  handleRestoreSQLiteFile,
  onManCorretoraChange,
  requestRestoreDatabase,
  requestWipeDatabase,
  setPositionsCorretora
});
