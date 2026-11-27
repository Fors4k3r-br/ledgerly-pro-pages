// Sincronização criptografada (LGP3) com Google Drive, OAuth via proxy, resolução de conflitos e indicador de status.

import { deriveSyncKey, sha256Bytes, sealDb, openDb } from '../security/encryption.js';
import { SQL, db, setDb, dailyDb, setDailyDb } from '../core/state.js';
import { createCentralSchema, createDailySchema, getSetting, persistSQLiteToIndexedDB, queryAll, rowsFromDatabase } from '../core/database.js';
import { refreshAllViews } from '../portfolio/positions.js';
import { bytesOf, hexOf } from '../security/lock-screen.js';
import { ledgerlyModal, openConfirmDialog, renderThemeCard, showToast, switchTab } from '../ui/navigation.js';

// ===== SINCRONIZAÇÃO COM GOOGLE DRIVE =====
const GOOGLE_CLIENT_ID = '708031911015-r1ujdi4nug06jsn2fldc26m51fvumamq.apps.googleusercontent.com';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const SYNC_FILE = 'ledgerly_pair_v3.db.enc';
const SYNC_LS = 'ledgerly_sync';
let gToken = null, gTokenExp = 0, syncBusy = false, syncTimer = null, syncError = '', syncPending = true, conflictInfo = null, tapArmed = false, syncConflict = false, syncCloudMissing = false;
export let prefetched = null;
export function setPrefetched(value) { prefetched = value; }
export function setSyncStatusFlags({ syncPending: p, syncCloudMissing: m, syncConflict: c } = {}) {
  if (typeof p === 'boolean') syncPending = p;
  if (typeof m === 'boolean') syncCloudMissing = m;
  if (typeof c === 'boolean') syncConflict = c;
}

export function syncState() { try { return JSON.parse(localStorage.getItem(SYNC_LS) || '{}'); } catch (_) { return {}; } }
export function saveSyncState(patch) { const s = Object.assign(syncState(), patch); try { localStorage.setItem(SYNC_LS, JSON.stringify(s)); } catch (_) {} return s; }

// Chave de criptografia derivada da senha: guardada neste aparelho como CryptoKey não exportável
function syncKeyDb() { return new Promise((res, rej) => { const r = indexedDB.open('Ledgerly_Sync', 1); r.onupgradeneeded = () => r.result.createObjectStore('keys'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
export async function idbKv(op, key, val) {
  const d = await syncKeyDb();
  return new Promise((res, rej) => {
    const t = d.transaction('keys', op === 'get' ? 'readonly' : 'readwrite');
    const s = t.objectStore('keys');
    const q = op === 'get' ? s.get(key) : op === 'put' ? s.put(val, key) : s.delete(key);
    t.oncomplete = () => { d.close(); res(op === 'get' ? (q.result || null) : undefined); };
    t.onerror = () => { d.close(); rej(t.error || new Error('Erro na transação de chaves no IndexedDB.')); };
    t.onabort = () => { d.close(); rej(t.error || new Error('Transação de chaves abortada no IndexedDB.')); };
  });
}
async function keyGet() { return idbKv('get', 'main'); }
async function keyPut(v) { return idbKv('put', 'main', v); }
async function keyDel() { return idbKv('del', 'main'); }

// As primitivas criptográficas são fornecidas por src/js/security/encryption.js.
// Não envia a biometria (credencial exclusiva de cada aparelho); o token da brapi vai junto, criptografado
export function sanitizedExport(raw) {
  const tmp = new SQL.Database(raw);
  tmp.run("DELETE FROM configuracoes_seguranca WHERE chave = 'biometrics_cred_id'");
  const out = tmp.export(); tmp.close(); return out;
}
export function isLocalEmpty() {
  const n = t => Number(queryAll(`SELECT COUNT(*) AS n FROM ${t}`)[0].n);
  return n('operacoes') + n('notas_corretagem') + n('proventos') === 0;
}

// Login do Google (token de acesso válido por cerca de 1 hora)
function loadGIS() {
  if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = res; s.onerror = () => rej(new Error('Não foi possível carregar o login do Google. Verifique a internet.'));
    document.head.appendChild(s);
  });
}
function hasValidToken() { return Boolean(gToken) && Date.now() < gTokenExp - 60000; }
// Login único: o servidor (Cloudflare) guarda o segredo do Google e troca/renova os tokens; o app guarda só o refresh token deste aparelho
const AUTH_PROXY_URL = 'https://ledgerly-auth-proxy.appsbyfors4k3r.workers.dev/';
async function authProxy(payload) {
  const r = await fetch(AUTH_PROXY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  let data = null; try { data = await r.json(); } catch (_) {}
  if (!r.ok || !data || data.error) {
    const e = new Error((data && (data.error_description || data.error)) || `Servidor de login (${r.status})`);
    e.code = data && data.error; e.permanent = e.code === 'invalid_grant';   // acesso expirado ou revogado
    throw e;
  }
  return data;
}
function applyTokenResponse(d) {
  if (!d || !d.access_token) throw new Error('Resposta de login inválida.');
  gToken = d.access_token; gTokenExp = Date.now() + (Number(d.expires_in) || 3000) * 1000;
}
function requestAuthCode() {
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initCodeClient({
      client_id: GOOGLE_CLIENT_ID, scope: DRIVE_SCOPE, ux_mode: 'popup',
      callback: r => r.error ? reject(new Error(r.error_description || r.error)) : resolve(r.code),
      error_callback: e => { const x = new Error(e && e.type === 'popup_closed' ? 'Login cancelado.' : 'Falha no login do Google.'); x.cancelled = Boolean(e && e.type === 'popup_closed'); reject(x); }
    });
    client.requestCode();
  });
}
export async function getToken(mode = 'interactive') {
  if (hasValidToken()) return gToken;
  const saved = await idbKv('get', 'refresh').catch(() => null);
  if (saved) {
    try { applyTokenResponse(await authProxy({ action: 'refresh_token', refresh_token: saved })); return gToken; }
    catch (e) {
      if (e.permanent) await idbKv('del', 'refresh').catch(() => {});   // expirou (no modo de teste do Google: 7 dias) ou foi revogado
      else if (mode === 'silent') throw e;                                // sem rede / servidor fora: mantém o acesso salvo
    }
  }
  if (mode === 'silent') throw new Error('login_required');
  await loadGIS();
  const data = await authProxy({ action: 'exchange_code', code: await requestAuthCode(), redirect_uri: 'postmessage' });
  applyTokenResponse(data);
  if (data.refresh_token) await idbKv('put', 'refresh', data.refresh_token).catch(() => {});
  else showToast('O Google não liberou o acesso permanente: o login vale por 1 hora. Remova o app em myaccount.google.com/permissions e conecte de novo.', 'info');
  return gToken;
}

// API do Drive (pasta oculta do app)
async function driveFetch(url, opts, token) {
  const r = await fetch(url, Object.assign({}, opts, { headers: Object.assign({ Authorization: 'Bearer ' + token }, (opts && opts.headers) || {}) }));
  if (r.status === 401) { gToken = null; gTokenExp = 0; }
  if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error(`Google Drive (${r.status}) ${t.slice(0, 100)}`); }
  return r;
}
async function driveFindAll(token) {
  const q = encodeURIComponent(`name='${SYNC_FILE}' and trashed=false`);
  const found = []; let pageToken = '';
  do {
    const page = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '';
    const r = await driveFetch(`https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id,appProperties,modifiedTime),nextPageToken&orderBy=modifiedTime%20desc&pageSize=100${page}`, {}, token);
    const data = await r.json(); found.push(...(data.files || [])); pageToken = data.nextPageToken || '';
  } while (pageToken);
  return found;
}
export async function driveFind(token) { return (await driveFindAll(token))[0] || null; }
export async function driveDeleteExtras(token, keepId) {
  const files = await driveFindAll(token);
  for (const file of files) if (file.id !== keepId) await driveDelete(file.id, token);
}
export async function driveDownload(id, token) { return (await driveFetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, {}, token)).arrayBuffer(); }
async function driveDelete(id, token) { await driveFetch(`https://www.googleapis.com/drive/v3/files/${id}`, { method: 'DELETE' }, token); }
async function driveUpload(bytes, props, id, token) {
  const meta = id ? { appProperties: props } : { name: SYNC_FILE, parents: ['appDataFolder'], appProperties: props };
  const b = 'ledgerly' + Math.random().toString(36).slice(2);
  const body = new Blob([`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: application/octet-stream\r\n\r\n`, bytes, `\r\n--${b}--`]);
  const base = 'https://www.googleapis.com/upload/drive/v3/files';
  const r = await driveFetch(id ? `${base}/${id}?uploadType=multipart&fields=id,appProperties` : `${base}?uploadType=multipart&fields=id,appProperties`,
    { method: id ? 'PATCH' : 'POST', headers: { 'Content-Type': `multipart/related; boundary=${b}` }, body }, token);
  return r.json();
}

export async function exportSyncPackage() {
  if (!db || !dailyDb) throw new Error('Os dois bancos ainda não estão disponíveis.');
  return packSyncPackage(db.export(), dailyDb.export());
}

export async function hashCurrentPair() {
  const a=db.export(), b=dailyDb.export(), joined=new Uint8Array(8+a.length+b.length);
  const view=new DataView(joined.buffer); view.setUint32(0,a.length,false); view.setUint32(4,b.length,false);
  joined.set(a,8); joined.set(b,8+a.length); return sha256Bytes(joined);
}

export async function packSyncPackage(central,daily) {
  const a=new Uint8Array(central), b=new Uint8Array(daily);
  const manifest={format:'LedgerlyPair',formatVersion:3,pairId:`${Date.now()}-${hexOf(crypto.getRandomValues(new Uint8Array(6)))}`,createdAt:new Date().toISOString(),central:{file:'central.db',schemaVersion:3,sha256:await sha256Bytes(a)},daily:{file:'daily.db',schemaVersion:1,sha256:await sha256Bytes(b)}};
  const meta=new TextEncoder().encode(JSON.stringify(manifest));
  const out=new Uint8Array(16+meta.length+a.length+b.length);
  out.set(new TextEncoder().encode('LGP3'),0);
  const v=new DataView(out.buffer); v.setUint32(4,meta.length,false); v.setUint32(8,a.length,false); v.setUint32(12,b.length,false);
  out.set(meta,16); out.set(a,16+meta.length); out.set(b,16+meta.length+a.length);
  return out;
}

export async function unpackSyncPackage(bytes) {
  const data=new Uint8Array(bytes);
  if (data.length<16 || new TextDecoder().decode(data.slice(0,4))!=='LGP3') throw new Error('A cópia não contém um conjunto Ledgerly central + diário atualizado (formato LGP3). A versão antiga do Drive foi preservada e não será sobrescrita automaticamente.');
  const view=new DataView(data.buffer,data.byteOffset,data.byteLength);
  const metaLen=view.getUint32(4,false), centralLen=view.getUint32(8,false);
  const dailyLen=view.getUint32(12,false);
  const metaStart=16, centralStart=metaStart+metaLen, dailyStart=centralStart+centralLen;
  if (metaLen<=0 || centralLen<=0 || dailyLen<=0 || dailyStart+dailyLen!==data.length) throw new Error('Pacote de sincronização incompleto.');
  const manifest=JSON.parse(new TextDecoder().decode(data.slice(metaStart,centralStart)));
  if (manifest.format!=='LedgerlyPair' || manifest.formatVersion!==3) throw new Error('Manifesto do conjunto Ledgerly inválido.');
  const central=data.slice(centralStart,dailyStart), daily=data.slice(dailyStart,dailyStart+dailyLen);
  if (await sha256Bytes(central)!==manifest.central.sha256 || await sha256Bytes(daily)!==manifest.daily.sha256) throw new Error('O hash de um dos bancos não confere com o manifesto.');
  return {central,daily,manifest};
}

function validateDatabase(database, requiredTable) {
  if (!rowsFromDatabase(database, "SELECT name FROM sqlite_master WHERE type='table' AND name=?",[requiredTable]).length) throw new Error('Um dos bancos do pacote não possui o schema esperado.');
  const integrity=rowsFromDatabase(database,'PRAGMA integrity_check');
  if (!integrity.length || integrity[0].integrity_check!=='ok') throw new Error('Falha na integridade de um dos bancos.');
  if (rowsFromDatabase(database,'PRAGMA foreign_key_check').length) throw new Error('Foram encontrados vínculos inválidos em um dos bancos.');
}

export function validateDatabasePair(central,daily) {
  validateDatabase(central,'operacoes'); validateDatabase(daily,'snapshots_patrimonio');
  const centralTables=rowsFromDatabase(central,"SELECT name FROM sqlite_master WHERE type='table'").map(x=>x.name);
  const dailyTables=rowsFromDatabase(daily,"SELECT name FROM sqlite_master WHERE type='table'").map(x=>x.name);
  if (centralTables.includes('snapshots_patrimonio') || centralTables.includes('snapshot_patrimonio_ativos')) throw new Error('O histórico patrimonial foi encontrado dentro do central.db.');
  if (dailyTables.includes('ativos') || dailyTables.includes('operacoes') || dailyTables.includes('notas_corretagem')) throw new Error('O daily.db contém tabelas que pertencem ao central.db.');
  const cv=Number(rowsFromDatabase(central,'SELECT MAX(version) v FROM schema_migrations')[0]?.v||0);
  const dv=Number(rowsFromDatabase(daily,'SELECT MAX(version) v FROM schema_migrations')[0]?.v||0);
  if (cv!==3 || dv!==1) throw new Error('Os bancos possuem versões de schema incompatíveis.');
}

export async function applyRemoteDb(bytes) {
  const pair = await unpackSyncPackage(bytes);
  const nextCentral = new SQL.Database(pair.central), nextDaily = new SQL.Database(pair.daily);
  try {
    if (pair.manifest.central.schemaVersion !== 3 || pair.manifest.daily.schemaVersion !== 1) {
      throw new Error('Versões de schema incompatíveis no manifesto.');
    }
    validateDatabasePair(nextCentral, nextDaily);
  } catch (error) {
    nextCentral.close(); nextDaily.close(); throw error;
  }
  const localBiometricId = getSetting('biometrics_cred_id');
  window.__ledgerlyApplying = true;
  const oldCentral = db, oldDaily = dailyDb;
  let swapped = false;
  try {
    setDb(nextCentral); setDailyDb(nextDaily);
    createCentralSchema(db); createDailySchema(dailyDb);
    if (localBiometricId && !getSetting('biometrics_cred_id')) {
      db.run("INSERT OR REPLACE INTO configuracoes_seguranca(chave,valor) VALUES('biometrics_cred_id',?)", [localBiometricId]);
    }
    if (!getSetting('biometrics_cred_id')) {
      db.run("INSERT OR REPLACE INTO configuracoes_seguranca(chave,valor) VALUES('biometrics_enabled','0')");
    }
    await persistSQLiteToIndexedDB({ suppressSync: true });
    swapped = true;
  } catch (error) {
    try { db?.close(); dailyDb?.close(); } catch (_) {}
    setDb(oldCentral); setDailyDb(oldDaily);
    throw error;
  } finally {
    window.__ledgerlyApplying = false;
  }
  if (swapped) {
    try { oldCentral?.close(); oldDaily?.close(); } catch (_) {}
    try {
      refreshAllViews();
    } catch (uiError) {
      console.error('Banco remoto aplicado, mas houve erro ao atualizar a interface:', uiError);
    }
  }
}

// Obtém (ou cria) a chave de criptografia deste aparelho
export async function ensureKey(remote, token) {
  const remoteSalt = remote && remote.appProperties && remote.appProperties.salt;
  let kd = await keyGet();
  if (kd && (!remoteSalt || hexOf(kd.salt) === remoteSalt)) return { kd };
  const cancel = () => { const e = new Error('Sincronização cancelada.'); e.cancelled = true; return e; };
  if (remote && remoteSalt) {
    const salt = bytesOf(remoteSalt);
    for (;;) {
      const r = await ledgerlyModal({ title: 'Senha de sincronização', message: 'Digite a senha usada para criptografar o banco na nuvem.', password: 1,
        buttons: [{ label: 'Entrar', value: 'ok', primary: true, needsPw: true }, { label: 'Esqueci a senha', value: 'forgot' }, { label: 'Cancelar', value: 'cancel' }] });
      if (r.value === 'cancel') throw cancel();
      if (r.value === 'forgot') {
        const c = await ledgerlyModal({ title: 'Recriar a cópia na nuvem?', message: 'A cópia atual no Drive será APAGADA (não há como recuperá-la sem a senha) e substituída pelos dados deste aparelho, com uma nova senha.',
          buttons: [{ label: 'Apagar e recriar', value: 'ok', primary: true }, { label: 'Voltar', value: 'back' }] });
        if (c.value !== 'ok') continue;
        await driveDelete(remote.id, token);
        await keyDel().catch(() => {});
        const created = await ensureKey(null, token);
        return { kd: created.kd, remoteDeleted: true };
      }
      const key = await deriveSyncKey(r.pw, salt);
      try {
        const bytes = await openDb(await driveDownload(remote.id, token), key);
        prefetched = { rev: remote.appProperties.rev, bytes };
      } catch (e) { if (e.wrongPassword) { showToast('Senha incorreta.', 'error'); continue; } throw e; }
      kd = { key, salt }; await keyPut(kd); return { kd };
    }
  }
  const r = await ledgerlyModal({ title: 'Criar senha de sincronização', message: 'Esta senha criptografa o banco antes de ir para o Google Drive. Ela NÃO pode ser recuperada: se você esquecer, os dados da nuvem ficam ilegíveis. Você vai usá-la nos outros aparelhos.', password: 2,
    buttons: [{ label: 'Criar senha e conectar', value: 'ok', primary: true, needsPw: true }, { label: 'Cancelar', value: 'cancel' }] });
  if (r.value !== 'ok') throw cancel();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  kd = { key: await deriveSyncKey(r.pw, salt), salt };
  await keyPut(kd);
  return { kd };
}

async function syncNow(mode = true) {
  // mode: true = toque do usuário (com avisos) | false = automático (sem login) | 'start' = ao abrir o app | 'tap' = primeiro toque após expirar o login
  const manual = mode === true;
  const st0 = syncState();
  if (!st0.connected || syncBusy) return false;
  if (!navigator.onLine) { if (manual) showToast('Sem internet. A sincronização ocorre quando a conexão voltar.', 'info'); updateConnectionBadge(); return false; }
  syncBusy = true; syncError = ''; prefetched = null; updateConnectionBadge(); renderSyncCard();
  let ok = false;
  try {
    let token;
    if (hasValidToken()) token = gToken;
    else if (mode === 'start' || mode === false) {
      try { token = await getToken('silent'); }
      catch (_) { saveSyncState({ needsLogin: true }); armTapSync(); return false; }
    } else token = await getToken('interactive');
    saveSyncState({ needsLogin: false });
    const remoteFiles = await driveFindAll(token);
    let remote = remoteFiles[0] || null;
    const ek = await ensureKey(remote, token);
    const kd = ek.kd;
    if (ek.remoteDeleted) remote = null;
    const st = syncState();
    const raw = await exportSyncPackage();
    const localHash = await hashCurrentPair();
    const dirty = localHash !== st.syncedHash;
    const remoteRev = remote && remote.appProperties ? remote.appProperties.rev : null;
    const remoteTsIso = remote ? ((remote.appProperties && remote.appProperties.ts) || remote.modifiedTime || '') : '';
    syncConflict = false; syncCloudMissing = false;
    let action = 'none', conflict = false;
    if (!remote && st.baseRev && !ek.remoteDeleted) {
      // A cópia da nuvem foi excluída (em outro aparelho): não recria sem perguntar
      if (!manual) { syncCloudMissing = true; return false; }
      const r = await ledgerlyModal({ title: 'Cópia da nuvem não encontrada', message: 'A cópia no Google Drive foi excluída. Quer recriá-la a partir deste aparelho ou desconectar a sincronização aqui?',
        buttons: [{ label: 'Recriar a partir deste aparelho', value: 'recreate', primary: true }, { label: 'Desconectar neste aparelho', value: 'disconnect' }, { label: 'Cancelar', value: 'cancel' }] });
      if (r.value === 'cancel') { const e = new Error('Sincronização cancelada.'); e.cancelled = true; throw e; }
      if (r.value === 'disconnect') { await disconnectSyncLocal(); showToast('Sincronização desativada neste aparelho.', 'info'); return false; }
      action = 'upload';
    }
    else if (!remote) action = 'upload';
    else if (st.recoveredFromEmptyIdb || (isLocalEmpty() && st.baseRev && st.hasLocalUserChanges !== true)) {
      // Proteção contra perda de IndexedDB: nunca sobrescreve a nuvem com banco vazio.
      action = 'download';
    }
    else if (remoteRev === st.baseRev) action = dirty ? 'upload' : 'none';
    else if (isLocalEmpty() || (!dirty && st.baseRev)) action = 'download';
    else if (!st.baseRev) {
      // Primeira conexão com dados dos dois lados: ainda não há histórico para comparar horários, então pergunta
      const r = await ledgerlyModal({ title: 'Dados nos dois lados', message: 'Este aparelho e o Google Drive já têm dados diferentes. Qual versão você quer manter? A outra fica guardada para restaurar em Banco de dados.',
        buttons: [{ label: 'Usar a versão da nuvem', value: 'download', primary: true }, { label: 'Manter a versão deste aparelho', value: 'upload' }, { label: 'Cancelar', value: 'cancel' }] });
      if (r.value === 'cancel') { const e = new Error('Sincronização cancelada.'); e.cancelled = true; throw e; }
      action = r.value; conflict = true;
    } else if (st.hasLocalUserChanges === false) {
      // Apenas rotinas automáticas (snapshot diário / cotações) tocaram o banco local:
      // a versão da nuvem prevalece sem sobrescrever edições de outro aparelho.
      action = 'download';
    } else {
      // Os dois lados tiveram alterações reais
      const localIso = st.localChangedAt || new Date().toISOString();
      if (st.conflictMode === 'manual') {
        if (!manual) { syncConflict = true; return false; }   // espera o usuário tocar em sincronizar
        const fmt = iso => iso ? new Date(iso).toLocaleString('pt-BR') : 'desconhecido';
        const r = await ledgerlyModal({ title: 'Conflito de dados', message: `Os dois lados mudaram.\nNuvem: ${fmt(remoteTsIso)}\nEste aparelho: ${fmt(localIso)}\nA versão não escolhida fica guardada para restaurar.`,
          buttons: [{ label: 'Usar a versão da nuvem', value: 'download', primary: true }, { label: 'Manter a versão deste aparelho', value: 'upload' }, { label: 'Cancelar', value: 'cancel' }] });
        if (r.value === 'cancel') { const e = new Error('Sincronização cancelada.'); e.cancelled = true; throw e; }
        action = r.value;
      } else {
        action = Date.parse(localIso) > (Date.parse(remoteTsIso) || 0) ? 'upload' : 'download';
      }
      conflict = true;
    }
    if (conflict) {
      if (action === 'download') await saveConflictBackup(raw, 'este aparelho');
      else await saveConflictBackup((prefetched && prefetched.rev === remoteRev) ? prefetched.bytes : await openDb(await driveDownload(remote.id, token), kd.key), 'nuvem');
    }
    // Antes de remover duplicatas num ciclo sem upload/download, valida o arquivo mais recente.
    if (action === 'none' && remote && remoteFiles.length > 1) {
      const checkBytes = (prefetched && prefetched.rev === remoteRev) ? prefetched.bytes : await openDb(await driveDownload(remote.id, token), kd.key);
      const checkedPair = await unpackSyncPackage(checkBytes);
      const checkCentral = new SQL.Database(checkedPair.central), checkDaily = new SQL.Database(checkedPair.daily);
      try { validateDatabasePair(checkCentral, checkDaily); } finally { checkCentral.close(); checkDaily.close(); }
    }
    if (action === 'upload') {
      const rev = hexOf(crypto.getRandomValues(new Uint8Array(8)));
      const pair = await unpackSyncPackage(raw);
      const safeCentral = sanitizedExport(pair.central);
      const syncPackage = await packSyncPackage(safeCentral, pair.daily);
      const uploadManifest = await unpackSyncPackage(syncPackage);
      const sealed = await sealDb(syncPackage, kd.key, kd.salt);
      const upTs = st.localChangedAt || new Date().toISOString();
      const meta = await driveUpload(sealed, { rev, salt: hexOf(kd.salt), ts: upTs, format: 'LGP3', pairId: uploadManifest.manifest.pairId, centralSchema: '3', dailySchema: '1', centralHash: uploadManifest.manifest.central.sha256, dailyHash: uploadManifest.manifest.daily.sha256 }, remote ? remote.id : null, token);
      saveSyncState({ fileId: meta.id, baseRev: rev, syncedHash: localHash, localChangedAt: upTs, hasLocalUserChanges: false, recoveredFromEmptyIdb: false });
    } else if (action === 'download') {
      const bytes = (prefetched && prefetched.rev === remoteRev) ? prefetched.bytes : await openDb(await driveDownload(remote.id, token), kd.key);
      await applyRemoteDb(bytes);
      saveSyncState({ fileId: remote.id, baseRev: remoteRev, syncedHash: await hashCurrentPair(), localChangedAt: remoteTsIso || new Date().toISOString(), hasLocalUserChanges: false, recoveredFromEmptyIdb: false });
    }
    saveSyncState({ lastSync: new Date().toISOString() });
    if (remote || action === 'upload') {
      try { await driveDeleteExtras(token, (syncState().fileId || (remote && remote.id) || null)); }
      catch (cleanupError) { console.warn('Não foi possível remover backups duplicados do Drive:', cleanupError); }
    }
    syncPending = false; ok = true;
    if (conflict) showToast(`Conflito resolvido: ficou a versão ${(st.conflictMode === 'manual' || !st.baseRev) ? 'escolhida' : 'mais recente'} (${action === 'download' ? 'da nuvem' : 'deste aparelho'}). A outra foi guardada em Banco de dados.`, 'info');
    else if (manual) showToast(action === 'download' ? 'Dados atualizados a partir do Google Drive.' : action === 'upload' ? 'Dados enviados ao Google Drive.' : 'Tudo já está sincronizado.', 'success');
  } catch (e) {
    if (e && e.cancelled) { if (manual) showToast(e.message, 'info'); }
    else { syncError = (e && e.message) || 'Falha desconhecida'; console.error('Sincronização:', e); if (manual) showToast('Falha na sincronização: ' + syncError, 'error'); }
  } finally { syncBusy = false; updateConnectionBadge(); renderSyncCard(); }
  return ok;
}
export async function syncAfterPersist(options = {}) {
  const st = syncState();
  if (!st.connected || window.__ledgerlyApplying || !db || !dailyDb) return;
  if ((await hashCurrentPair()) === st.syncedHash) return;
  const userEdit = options.userEdit !== false;
  if (userEdit) {
    saveSyncState({ localChangedAt: new Date().toISOString(), hasLocalUserChanges: true, recoveredFromEmptyIdb: false });
  }
  syncPending = true; updateConnectionBadge();
  clearTimeout(syncTimer); syncTimer = setTimeout(() => syncNow(false), 4000);
}
// Login do Google expirado: no primeiro toque do usuário (gesto permitido), renova e sincroniza
function armTapSync() {
  if (tapArmed || !syncState().connected) return;
  tapArmed = true;
  document.addEventListener('click', () => { tapArmed = false; if (syncState().connected && !syncBusy && !hasValidToken()) syncNow('tap'); }, { once: true, capture: true });
}
export async function syncOnStart() {
  if (!syncState().connected) return true;
  syncPending = true; updateConnectionBadge();
  return await syncNow('start');
}
const MAX_CONFLICT_BACKUPS = 5;
let conflictBackups = [];
async function listConflictBackups() {
  let list = await idbKv('get', 'conflict_list').catch(() => null);
  if (!Array.isArray(list)) list = [];
  // Migração transparente da chave antiga de espaço único ('conflict')
  const legacy = await idbKv('get', 'conflict').catch(() => null);
  if (legacy && legacy.bytes) {
    const id = 'legacy_' + (Date.parse(legacy.at) || Date.now());
    await idbKv('put', 'conflict_' + id, legacy).catch(() => {});
    list.unshift({ id, side: legacy.side, at: legacy.at });
    list = list.slice(0, MAX_CONFLICT_BACKUPS);
    await idbKv('put', 'conflict_list', list).catch(() => {});
    await idbKv('del', 'conflict').catch(() => {});
  }
  return list;
}
export async function clearConflictBackups() {
  try {
    const list = await listConflictBackups();
    for (const item of list) await idbKv('del', 'conflict_' + item.id).catch(() => {});
    await idbKv('del', 'conflict_list').catch(() => {});
    await idbKv('del', 'conflict').catch(() => {});
  } catch (_) {}
  conflictBackups = [];
  conflictInfo = null;
}
async function saveConflictBackup(bytes, side) {
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const at = new Date().toISOString();
  const rec = { id, bytes: new Uint8Array(bytes), side, at };
  try {
    let list = await listConflictBackups();
    await idbKv('put', 'conflict_' + id, rec);
    list.unshift({ id, side, at });
    const removed = list.splice(MAX_CONFLICT_BACKUPS);
    for (const old of removed) await idbKv('del', 'conflict_' + old.id).catch(() => {});
    await idbKv('put', 'conflict_list', list);
    conflictBackups = list;
    conflictInfo = list[0] || null;
  } catch (e) {
    console.warn('Não foi possível salvar cópia de segurança do conflito:', e);
  }
}
async function refreshConflictInfo() {
  try {
    conflictBackups = await listConflictBackups();
    conflictInfo = conflictBackups[0] || null;
  } catch (_) {
    conflictBackups = [];
    conflictInfo = null;
  }
  renderSyncCard();
}
async function restoreConflictBackup() {
  const list = await listConflictBackups();
  if (!list.length) return;
  let chosen = list[0];
  if (list.length > 1) {
    const buttons = list.map((item, idx) => ({
      label: `${idx === 0 ? 'Mais recente · ' : ''}${sideLabel(item.side)} (${new Date(item.at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })})`,
      value: item.id,
      primary: idx === 0
    }));
    buttons.push({ label: 'Cancelar', value: 'cancel' });
    const pick = await ledgerlyModal({
      title: `Cópias de segurança (${list.length})`,
      message: 'Escolha qual versão guardada deseja restaurar:',
      buttons
    });
    if (pick.value === 'cancel') return;
    chosen = list.find(x => x.id === pick.value);
    if (!chosen) return;
  }
  const c = await idbKv('get', 'conflict_' + chosen.id);
  if (!c) return;
  const r = await ledgerlyModal({ title: 'Restaurar cópia guardada?', message: `Os dados atuais serão substituídos pela ${sideLabel(c.side)} guardada em ${new Date(c.at).toLocaleString('pt-BR')}.`,
    buttons: [{ label: 'Restaurar', value: 'ok', primary: true }, { label: 'Cancelar', value: 'cancel' }] });
  if (r.value !== 'ok') return;
  try {
    await applyRemoteDb(c.bytes);
    saveSyncState({ localChangedAt: new Date().toISOString(), hasLocalUserChanges: true, recoveredFromEmptyIdb: false });
    const nextList = list.filter(x => x.id !== chosen.id);
    await idbKv('del', 'conflict_' + chosen.id).catch(() => {});
    await idbKv('put', 'conflict_list', nextList).catch(() => {});
    conflictBackups = nextList;
    conflictInfo = nextList[0] || null;
    renderSyncCard();
    showToast('Versão restaurada.', 'success');
    if (syncState().connected) await syncNow(true);
  } catch (e) { showToast('Falha ao restaurar: ' + ((e && e.message) || e), 'error'); }
}
async function syncConnect() {
  saveSyncState({ connected: true, needsLogin: false }); syncPending = true;
  const ok = await syncNow(true);
  if (!ok) { const kd = await keyGet().catch(() => null); if (!kd) saveSyncState({ connected: false }); }
  updateConnectionBadge(); renderSyncCard();
}
async function syncDisconnect() {
  const r = await ledgerlyModal({ title: 'Desconectar do Google Drive?', message: 'Os dados continuam neste aparelho e a cópia na nuvem não é apagada. Para reconectar você precisará da senha de sincronização.',
    buttons: [{ label: 'Desconectar', value: 'ok', primary: true }, { label: 'Cancelar', value: 'cancel' }] });
  if (r.value !== 'ok') return;
  await disconnectSyncLocal();
  updateConnectionBadge(); renderSyncCard(); showToast('Sincronização desativada neste aparelho.', 'info');
}
function sideLabel(side) { return side === 'nuvem' ? 'versão da nuvem' : side === 'limpeza' ? 'cópia de antes de limpar os dados' : 'versão deste aparelho'; }
function setConflictMode(mode) { saveSyncState({ conflictMode: mode === 'manual' ? 'manual' : 'auto' }); renderSyncCard(); }
export async function disconnectSyncLocal() {
  saveSyncState({ connected: false, baseRev: null, syncedHash: null, fileId: null, needsLogin: false, localChangedAt: null, hasLocalUserChanges: false, recoveredFromEmptyIdb: false });
  syncConflict = false; syncCloudMissing = false; clearTimeout(syncTimer);
  await keyDel().catch(() => {}); await idbKv('del', 'refresh').catch(() => {}); gToken = null; gTokenExp = 0;
}
export async function deleteCloudDb() {
  if (!navigator.onLine) throw new Error('Sem internet. Conecte-se para excluir a cópia da nuvem.');
  const token = await getToken('interactive');
  const remotes = await driveFindAll(token);
  for (const remote of remotes) await driveDelete(remote.id, token);
  return remotes.length > 0;
}
async function deleteLocalDb() {
  clearTimeout(syncTimer); window.__ledgerlyApplying=true;
  const oldCentral=db, oldDaily=dailyDb;
  try {
    setDb(new SQL.Database()); setDailyDb(new SQL.Database());
    createCentralSchema(db); createDailySchema(dailyDb);
    await persistSQLiteToIndexedDB({suppressSync:true});
    try { oldCentral?.close(); oldDaily?.close(); } catch(_) {}
  } catch(error) {
    try { db?.close(); dailyDb?.close(); } catch(_) {}
    setDb(oldCentral); setDailyDb(oldDaily); throw error;
  } finally { window.__ledgerlyApplying=false; }
  await clearConflictBackups();
  try { localStorage.removeItem('ledgerly_pin_fails'); localStorage.removeItem('ledgerly_pin_lock'); } catch(_) {}
}
// scope: 'local' | 'cloud' | 'all'. A nuvem é apagada primeiro: se falhar, nada é apagado no aparelho.
async function performDeleteDatabase(scope) {
  if (scope !== 'local') await deleteCloudDb();
  await disconnectSyncLocal();
  if (scope !== 'cloud') await deleteLocalDb();
}
async function requestDeleteDatabase() {
  const r = await ledgerlyModal({ title: 'Excluir banco de dados', message: 'O que você quer excluir?',
    buttons: [{ label: 'Somente neste aparelho', value: 'local' }, { label: 'Somente a nuvem (Google Drive)', value: 'cloud' }, { label: 'Tudo (aparelho e nuvem)', value: 'all' }, { label: 'Cancelar', value: 'cancel' }] });
  if (r.value === 'cancel') return;
  const txt = {
    local: ['Excluir neste aparelho', 'Apaga todos os dados DESTE aparelho (inclusive PIN e token) e desconecta a sincronização. A cópia no Google Drive é mantida e pode ser baixada ao reconectar.'],
    cloud: ['Excluir a cópia da nuvem', 'Apaga a cópia criptografada no Google Drive e desconecta a sincronização neste aparelho. Os dados deste aparelho são mantidos. Outros aparelhos conectados vão perguntar o que fazer.'],
    all: ['Excluir tudo', 'Apaga a cópia no Google Drive e todos os dados deste aparelho (inclusive PIN e token). Esta ação não pode ser desfeita.']
  }[r.value];
  openConfirmDialog({ title: txt[0], message: txt[1], requirePin: Boolean(getSetting('security_pin_hash')),
    onConfirm: async () => {
      try {
        await performDeleteDatabase(r.value);
        updateConnectionBadge(); renderSyncCard();
        if (r.value === 'cloud') { showToast('Cópia da nuvem excluída. Sincronização desconectada neste aparelho.', 'info'); return; }
        showToast('Banco de dados excluído. Reiniciando…', 'info');
        setTimeout(() => location.reload(), 900);
      } catch (e) { if (!(e && e.cancelled)) showToast('Falha ao excluir: ' + ((e && e.message) || e), 'error'); }
    } });
}
// Limpa dados de investimentos sem remover PIN, token da brapi ou configurações locais.
export async function wipeAllData(options = {}) {
  if (options.keepLocalRecovery !== false) await saveConflictBackup(await exportSyncPackage(), 'limpeza');
  db.run('DELETE FROM operacoes; DELETE FROM notas_corretagem; DELETE FROM proventos; DELETE FROM cotacoes_atuais; DELETE FROM corretoras; DELETE FROM ativos;');
  dailyDb.run('DELETE FROM snapshot_patrimonio_ativos; DELETE FROM snapshots_patrimonio;');
  await persistSQLiteToIndexedDB({ suppressSync: Boolean(options.suppressSync) });
}
export function renderSyncCard() {
  const st = syncState();
  const when = st.lastSync ? new Date(st.lastSync) : null;
  const sum = document.getElementById('syncSummaryText');
  if (sum) sum.textContent = st.connected ? 'Conectado' + (when ? ' · sinc. ' + when.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '') : 'Google Drive e regras de conflito';
  const cm = st.conflictMode === 'manual' ? 'conflictModeManual' : 'conflictModeAuto';
  const radio = document.getElementById(cm); if (radio) radio.checked = true;
  const cb = document.getElementById('syncRestoreConflictBtn'), ci = document.getElementById('syncConflictInfo');
  if (cb) {
    cb.classList.toggle('hidden', !conflictInfo);
    cb.textContent = conflictBackups.length > 1 ? `Restaurar cópia guardada (${conflictBackups.length})` : 'Restaurar cópia guardada';
  }
  if (ci) {
    ci.classList.toggle('hidden', !conflictInfo);
    if (conflictInfo) {
      const extra = conflictBackups.length > 1 ? ` (+${conflictBackups.length - 1} anterior${conflictBackups.length > 2 ? 'es' : ''})` : '';
      ci.textContent = `Cópia mais recente: ${sideLabel(conflictInfo.side)}, de ${new Date(conflictInfo.at).toLocaleString('pt-BR')}${extra}.`;
    }
  }
  const el = document.getElementById('syncStatusText'); if (!el) return;
  const hide = (id, v) => { const x = document.getElementById(id); if (x) { x.classList.toggle('hidden', v); x.disabled = syncBusy; } };
  hide('syncConnectBtn', !!st.connected); hide('syncNowBtn', !st.connected); hide('syncDisconnectBtn', !st.connected);
  el.textContent = !st.connected ? 'Não conectado: seus dados ficam só neste aparelho e podem ser perdidos se você limpar os dados do navegador.'
    : syncBusy ? 'Sincronizando…'
    : syncConflict ? 'Conflito pendente: toque em “Sincronizar agora” para escolher qual versão manter.'
    : syncCloudMissing ? 'A cópia da nuvem não foi encontrada. Toque em “Sincronizar agora” para decidir.'
    : syncError ? 'Erro: ' + syncError : (when ? 'Conectado · última sincronização em ' + when.toLocaleString('pt-BR') : 'Conectado · ainda não sincronizado');
}
// ===== FIM DA SINCRONIZAÇÃO =====

function syncVisualStatus() {
  const st = syncState();
  if (!navigator.onLine) return { key: 'offline', label: 'Offline', color: '#94a3b8', glow: 'rgba(148,163,184,.18)' };
  if (!st.connected) return { key: 'disconnected', label: 'Drive desconectado', color: '#94a3b8', glow: 'rgba(148,163,184,.18)' };
  if (syncConflict || syncCloudMissing || syncError) return { key: 'error', label: 'Atenção necessária', color: '#ef4444', glow: 'rgba(239,68,68,.20)' };
  if (syncBusy) return { key: 'busy', label: 'Sincronizando', color: '#f59e0b', glow: 'rgba(245,158,11,.20)' };
  if (syncPending) return { key: 'pending', label: 'Alterações pendentes', color: '#f59e0b', glow: 'rgba(245,158,11,.20)' };
  if (st.needsLogin) return { key: 'auth', label: 'Autorização necessária', color: '#f59e0b', glow: 'rgba(245,158,11,.20)' };
  return { key: 'ok', label: 'Sincronizado', color: '#22c55e', glow: 'rgba(34,197,94,.20)' };
}
function renderSyncStatusPopover() {
  const st = syncState();
  const visual = syncVisualStatus();
  const set = (id, value, color) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = value;
    if (color) el.style.color = color;
  };
  const internet = navigator.onLine;
  set('syncDetailInternet', internet ? 'Conectado' : 'Sem conexão', internet ? '#34d399' : '#94a3b8');
  set('syncDetailDrive', !st.connected ? 'Não conectado neste aparelho' : (st.needsLogin ? 'Conectado · autorização necessária' : 'Conectado'), st.connected ? (st.needsLogin ? '#fbbf24' : '#34d399') : '#94a3b8');
  let dataText = 'Somente neste aparelho';
  if (st.connected) {
    if (!internet) dataText = 'Aguardando conexão';
    else if (syncBusy) dataText = 'Enviando ou recebendo dados';
    else if (syncConflict) dataText = 'Conflito aguardando decisão';
    else if (syncCloudMissing) dataText = 'Cópia da nuvem não encontrada';
    else if (syncError) dataText = 'Falha na sincronização';
    else if (st.needsLogin) dataText = 'Aguardando autorização';
    else if (syncPending) dataText = 'Alterações aguardando envio';
    else dataText = 'Dados atualizados';
  }
  const dataColor = (syncConflict || syncCloudMissing || syncError) ? '#f87171' : (syncBusy || syncPending || st.needsLogin) ? '#fbbf24' : st.connected && internet ? '#34d399' : '#cbd5e1';
  set('syncDetailData', dataText, dataColor);
  const last = document.getElementById('syncDetailLastSync');
  if (last) last.textContent = st.lastSync ? new Date(st.lastSync).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'Ainda não houve sincronização concluída';
  const notice = document.getElementById('syncDetailNotice');
  let noticeText = '';
  if (!internet) noticeText = 'O aplicativo continua usando os dados locais. A sincronização será tentada quando a internet voltar.';
  else if (!st.connected) noticeText = 'O banco está salvo neste aparelho. Conecte o Google Drive em Configurações → Banco de dados → Sincronização para manter os aparelhos atualizados.';
  else if (syncConflict) noticeText = 'Há alterações diferentes neste aparelho e na nuvem. Toque em “Sincronizar agora” para escolher qual versão manter.';
  else if (syncCloudMissing) noticeText = 'A cópia do Google Drive não foi encontrada. Abra a sincronização para decidir se deseja recriá-la.';
  else if (syncError) noticeText = 'Não foi possível concluir a sincronização: ' + syncError;
  else if (st.needsLogin) noticeText = 'É necessária uma nova autorização da conta Google para continuar.';
  else if (syncPending && !syncBusy) noticeText = 'Existem alterações locais aguardando envio ao Google Drive.';
  else if (syncBusy) noticeText = 'Aguarde enquanto o banco de dados é enviado ou atualizado no Google Drive.';
  else if (st.connected) noticeText = 'O banco deste aparelho e a cópia do Google Drive estão sincronizados.';
  if (notice) { notice.textContent = noticeText; notice.classList.toggle('hidden', !noticeText); }
  const action = document.getElementById('syncDetailAction');
  if (action) {
    action.textContent = !st.connected ? 'Configurar Google Drive' : !internet ? 'Aguardando conexão' : syncBusy ? 'Sincronizando…' : (syncConflict || syncCloudMissing || syncError || st.needsLogin) ? 'Resolver / tentar novamente' : 'Sincronizar agora';
    action.disabled = Boolean(st.connected && (!internet || syncBusy));
  }
  const badge = document.getElementById('dbStatusBadge');
  const led = document.getElementById('syncStatusLed');
  if (led) {
    led.style.backgroundColor = visual.color;
    led.style.boxShadow = `0 0 0 3px ${visual.glow}`;
    // A pulsação indica transferência em andamento; pendências ficam estáticas.
    led.classList.toggle('sync-led-pulsing', Boolean(syncBusy && visual.key === 'busy'));
  }
  if (badge) { badge.setAttribute('aria-label', 'Status: ' + visual.label + '. Toque para ver detalhes.'); badge.title = visual.label; }
  const pop = document.getElementById('syncStatusPopover');
  if (pop && !pop.classList.contains('hidden')) pop.setAttribute('data-status', visual.key);
}
export function updateConnectionBadge() { renderSyncStatusPopover(); }
function toggleSyncStatusPanel(force) {
  const panel = document.getElementById('syncStatusPopover');
  const badge = document.getElementById('dbStatusBadge');
  if (!panel || !badge) return;
  const open = typeof force === 'boolean' ? force : panel.classList.contains('hidden');
  panel.classList.toggle('hidden', !open);
  panel.setAttribute('aria-hidden', String(!open));
  badge.setAttribute('aria-expanded', String(open));
  if (open) { renderSyncStatusPopover(); if (window.lucide) lucide.createIcons(); }
}
function handleSyncStatusAction() {
  const st = syncState();
  if (!st.connected) { toggleSyncStatusPanel(false); switchTab('sync'); return; }
  if (!navigator.onLine) { showToast('Sem internet. A sincronização será retomada quando a conexão voltar.', 'info'); return; }
  if (syncBusy) return;
  syncNow(true);
}
document.addEventListener('click', event => {
  const panel = document.getElementById('syncStatusPopover');
  if (!panel || panel.classList.contains('hidden')) return;
  if (!event.target.closest('#syncStatusPopover') && !event.target.closest('#dbStatusBadge')) toggleSyncStatusPanel(false);
});
document.addEventListener('keydown', event => { if (event.key === 'Escape') toggleSyncStatusPanel(false); });
window.addEventListener('online', () => { updateConnectionBadge(); if (syncState().connected && syncPending) syncNow(false); });
window.addEventListener('offline', updateConnectionBadge);
document.addEventListener('visibilitychange', () => { if (!document.hidden && syncState().connected && hasValidToken()) syncNow(false); });
document.addEventListener('DOMContentLoaded', () => { updateConnectionBadge(); renderSyncCard(); refreshConflictInfo(); renderThemeCard(); });

// Compatibilidade apenas para handlers inline no HTML/templates.
Object.assign(globalThis, {
  handleSyncStatusAction,
  requestDeleteDatabase,
  restoreConflictBackup,
  setConflictMode,
  syncConnect,
  syncDisconnect,
  syncNow,
  toggleSyncStatusPanel
});
